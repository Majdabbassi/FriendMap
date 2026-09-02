import { UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { FriendshipStatus } from '@prisma/client';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { VisibilityService } from '../sharing/visibility.service';
import { UpdateLocationDto } from './dto/update-location.dto';
import {
  filterUnauthorizedViewers,
  validateIncomingPoint,
} from './location.service';

type AuthenticatedSocket = Socket & { data: { userId?: string } };
type JwtPayload = { sub: string };
const LOCATION_UPDATE_INTERVAL_MS = 4_000;

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:8080',
    ],
    credentials: true,
  },
})
export class LocationGateway {
  @WebSocketServer()
  private server!: Server;
  private readonly lastLocationUpdateByUser = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly visibility: VisibilityService,
  ) {}

  private isLocationUpdateRateLimited(userId: string) {
    const now = Date.now();
    const lastUpdate = this.lastLocationUpdateByUser.get(userId);
    if (lastUpdate !== undefined && now - lastUpdate < LOCATION_UPDATE_INTERVAL_MS) {
      return true;
    }

    this.lastLocationUpdateByUser.set(userId, now);
    return false;
  }

  async handleConnection(socket: AuthenticatedSocket) {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      socket.data.userId = payload.sub;
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('location:update')
  @UsePipes(new ValidationPipe())
  async updateLocation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: UpdateLocationDto,
  ) {
    const userId = socket.data.userId as string;
    if (this.isLocationUpdateRateLimited(userId)) {
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
    this.server.to(`location:${userId}`).emit('location:update', {
      userId,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      updatedAt: payload.timestamp,
    });
  }

  @SubscribeMessage('view:friends')
  async viewFriends(@ConnectedSocket() socket: AuthenticatedSocket) {
    const userId = socket.data.userId as string;
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
    });
    const friendIds = friendships.map((friendship) =>
      friendship.requesterId === userId
        ? friendship.addresseeId
        : friendship.requesterId,
    );
    const authorizedFriendIds: string[] = [];
    for (const friendId of friendIds) {
      if (await this.visibility.canView(userId, friendId)) {
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
    socket.emit(
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
  async stopViewing(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { friendId: string },
  ) {
    await socket.leave(`location:${payload.friendId}`);
  }

  @OnEvent('sharing.mode-changed')
  onSharingModeChanged(event: { userId: string }) {
    return this.revokeUnauthorizedViewers(event.userId);
  }

  @OnEvent('sharing.list-changed')
  onSharingListChanged(event: { ownerId: string }) {
    return this.revokeUnauthorizedViewers(event.ownerId);
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
      sockets.map((socket) => socket.data.userId as string),
      (viewerId) => this.visibility.canView(viewerId, targetId),
    );

    for (const socket of sockets) {
      if (unauthorizedIds.includes(socket.data.userId as string)) {
        await socket.leave(room);
        socket.emit('location:hidden', { userId: targetId });
      }
    }
  }
}