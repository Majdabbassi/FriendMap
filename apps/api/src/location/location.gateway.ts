import { UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RedisService } from '../redis/redis.service';
import { RedisAdapterService } from '../redis/redis-adapter.service';
import { RedisThrottlerService } from '../throttling/redis-throttler.service';
import { VisibilityService } from '../sharing/visibility.service';
import { corsOrigins } from '../cors';
import { FriendshipsRepository } from '../friendships/friendships.repository';
import { LocationHistoryService } from './location-history.service';
import { StopViewingDto } from './dto/stop-viewing.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import {
  filterUnauthorizedViewers,
  validateIncomingPoint,
} from './location.service';

// Socket.IO Type Definitions for proper type safety
interface SocketData {
  userId?: string;
  stoppedViewingFriendIds?: Set<string>;
}

type JwtPayload = { sub: string };

@WebSocketGateway({
  cors: {
    origin: corsOrigins(),
    credentials: true,
  },
})
export class LocationGateway implements OnGatewayInit {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly redisAdapterService: RedisAdapterService,
    private readonly redisThrottler: RedisThrottlerService,
    private readonly visibility: VisibilityService,
    private readonly friendshipsRepository: FriendshipsRepository,
    private readonly history: LocationHistoryService,
  ) {}

  afterInit(server: Server) {
    this.redisAdapterService.createSocketIOAdapter(server);
  }

  private async isLocationUpdateRateLimited(userId: string): Promise<boolean> {
    const key = `rate-limit:location-update:${userId}`;
    return this.redisThrottler.isRateLimited(key, 12, 60); // 12 requests per minute (1 per 5 seconds)
  }

  async handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const socketData = socket.data as SocketData;
      socketData.userId = payload.sub;
      await socket.join(`user:${payload.sub}`);
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('location:update')
  @UsePipes(new ValidationPipe())
  async updateLocation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: UpdateLocationDto,
  ) {
    const socketData = socket.data as SocketData;
    const userId = socketData.userId as string;
    if (await this.isLocationUpdateRateLimited(userId)) {
      socket.emit('location:rejected', { reason: 'rate-limited' });
      return;
    }

    const previous = await this.redis.getCurrentLocation(userId);
    const result = validateIncomingPoint(previous, payload);
    if (!result.valid) {
      socket.emit('location:rejected', { reason: result.reason });
      return;
    }

    await this.redis.setCurrentLocation(userId, payload);
    await this.history.enqueueIfSampled(userId, payload);
    const viewers = await this.server.in(`location:${userId}`).fetchSockets();
    for (const viewer of viewers) {
      const viewerData = viewer.data as SocketData;
      if (viewerData.stoppedViewingFriendIds?.has(userId)) continue;
      (viewer as any).emit('location:update', {
        userId,
        lat: payload.lat,
        lng: payload.lng,
        accuracy: payload.accuracy,
        updatedAt: payload.timestamp,
      });
    }
  }

  @SubscribeMessage('view:friends')
  async viewFriends(@ConnectedSocket() socket: Socket) {
    const socketData = socket.data as SocketData;
    const userId = socketData.userId as string;
    const friendIds = await this.friendshipsRepository.findAcceptedFriendIds(userId);
    
    const visibilityResults = await this.visibility.canViewMany(userId, friendIds);
    const authorizedFriendIds: string[] = [];
    
    for (const friendId of friendIds) {
      if (socketData.stoppedViewingFriendIds?.has(friendId)) continue;
      if (visibilityResults.get(friendId)) {
        authorizedFriendIds.push(friendId);
        await socket.join(`location:${friendId}`);
      }
    }

    const locations = await Promise.all(
      authorizedFriendIds.map(async (friendId) => ({
        userId: friendId,
        location: await this.redis.getCurrentLocation(friendId),
      })),
    );
    (socket as any).emit(
      'location:snapshot',
      locations
        .filter(({ location }) => location !== null)
        .map(({ userId: friendId, location }) => ({
          userId: friendId,
          lat: location!.lat,
          lng: location!.lng,
          accuracy: location!.accuracy,
          updatedAt: location!.timestamp,
        })),
    );
  }

  @SubscribeMessage('view:stop')
  @UsePipes(new ValidationPipe())
  async stopViewing(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: StopViewingDto,
  ) {
    const socketData = socket.data as SocketData;
    socketData.stoppedViewingFriendIds ??= new Set<string>();
    socketData.stoppedViewingFriendIds.add(payload.friendId);
    await socket.leave(`location:${payload.friendId}`);
  }

  @SubscribeMessage('view:start')
  @UsePipes(new ValidationPipe())
  async resumeViewing(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: StopViewingDto,
  ) {
    const socketData = socket.data as SocketData;
    socketData.stoppedViewingFriendIds ??= new Set<string>();
    socketData.stoppedViewingFriendIds.delete(payload.friendId);

    const userId = socketData.userId as string;
    const authorized = await this.visibility.canView(userId, payload.friendId);
    if (!authorized) {
      socket.emit('location:hidden', { userId: payload.friendId });
      return;
    }

    await socket.join(`location:${payload.friendId}`);
    const location = await this.redis.getCurrentLocation(payload.friendId);
    if (location) {
      (socket as any).emit('location:snapshot', [
        {
          userId: payload.friendId,
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy,
          updatedAt: location.timestamp,
        },
      ]);
    }
  }

  @OnEvent('sharing.mode-changed')
  onSharingModeChanged(event: { userId: string }) {
    return Promise.all([
      this.revokeUnauthorizedViewers(event.userId),
      this.grantNewlyAuthorizedViewers(event.userId),
    ]);
  }

  @OnEvent('sharing.list-changed')
  onSharingListChanged(event: { ownerId: string }) {
    return Promise.all([
      this.revokeUnauthorizedViewers(event.ownerId),
      this.grantNewlyAuthorizedViewers(event.ownerId),
    ]);
  }

  @OnEvent('friendship.removed')
  onFriendshipRemoved(event: { userAId: string; userBId: string }) {
    return Promise.all([
      this.revokeUnauthorizedViewers(event.userAId),
      this.revokeUnauthorizedViewers(event.userBId),
    ]);
  }

  private async revokeUnauthorizedViewers(targetId: string) {
    const room = `location:${targetId}`;
    const sockets = await this.server.in(room).fetchSockets();
    const unauthorizedIds = await filterUnauthorizedViewers(
      sockets.map((socket) => (socket.data as SocketData).userId as string),
      (viewerId) => this.visibility.canView(viewerId, targetId),
    );

    for (const socket of sockets) {
      const socketData = socket.data as SocketData;
      if (unauthorizedIds.includes(socketData.userId as string)) {
        await socket.leave(room);
        (socket as any).emit('location:hidden', { userId: targetId });
      }
    }
  }

  private async grantNewlyAuthorizedViewers(targetId: string) {
    const friendIds = await this.friendshipsRepository.findAcceptedFriendIds(targetId);
    const visibilityResults = await this.visibility.canViewMany(targetId, friendIds);
    const authorizedFriendIds = friendIds.filter(friendId => visibilityResults.get(friendId));
    
    const location = await this.redis.getCurrentLocation(targetId);
    if (!location) return;

    const room = `location:${targetId}`;
    for (const friendId of authorizedFriendIds) {
      const sockets = await this.server.in(`user:${friendId}`).fetchSockets();
      for (const socket of sockets) {
        const socketData = socket.data as SocketData;
        if (socketData.stoppedViewingFriendIds?.has(targetId)) continue;
        if (!(socket.rooms as Set<string>).has(room)) await socket.join(room);
        (socket as any).emit('location:update', {
          userId: targetId,
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy,
          updatedAt: location.timestamp,
        });
      }
    }
  }
}