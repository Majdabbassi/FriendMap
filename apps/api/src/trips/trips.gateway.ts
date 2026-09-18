import { UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { corsOrigins } from '../cors';
import { PresenceService } from '../messages/presence.service';
import { RedisService } from '../redis/redis.service';
import { RedisThrottlerService } from '../throttling/redis-throttler.service';
import { SendTripMessageDto } from './dto/send-trip-message.dto';
import { TripTypingDto } from './dto/trip-typing.dto';
import { TripsRepository } from './trips.repository';

type JwtPayload = { sub: string };

type Message = {
  id: string;
  tripId: string;
  senderId: string;
  body: string;
  createdAt: Date;
};

export type TripJoinedPayload = {
  tripId: string;
  memberLocations: {
    userId: string;
    lat: number;
    lng: number;
    accuracy?: number;
    updatedAt: number;
  }[];
  presence: {
    onlineUserIds: string[];
    lastSeenByUserId: Record<string, number>;
  };
};

@WebSocketGateway({
  cors: {
    origin: corsOrigins(),
    credentials: true,
  },
})
export class TripsGateway {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly tripsRepository: TripsRepository,
    private readonly presenceService: PresenceService,
    private readonly redis: RedisService,
    private readonly redisThrottler: RedisThrottlerService,
  ) {}

  private async isMessageRateLimited(userId: string): Promise<boolean> {
    const key = `rate-limit:trip-chat:${userId}`;
    return this.redisThrottler.isRateLimited(key, 20, 60);
  }

  async handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      (socket.data as { userId?: string }).userId = payload.sub;
      await socket.join(`user:${payload.sub}`);
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('trip:join')
  @UsePipes(new ValidationPipe())
  async joinTrip(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { tripId: string },
  ) {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) return;

    const membership = await this.tripsRepository.findMember(payload.tripId, userId);
    if (!membership) {
      socket.emit('trip:error', { message: 'not-a-member' });
      return;
    }

    await socket.join(`trip:${payload.tripId}`);

    const memberIds = await this.tripsRepository.memberIds(payload.tripId);
    for (const memberId of memberIds) {
      await socket.join(`location:${memberId}`);
    }

    const locations = await Promise.all(
      memberIds.map(async (memberId) => ({
        userId: memberId,
        location: await this.redis.getCurrentLocation(memberId),
      })),
    );

    const presenceSnapshots = await this.presenceService.getManySnapshots(memberIds);
    const onlineUserIds: string[] = [];
    const lastSeenByUserId: Record<string, number> = {};
    for (const memberId of memberIds) {
      const snapshot = presenceSnapshots.get(memberId);
      if (!snapshot) continue;
      if (snapshot.online) onlineUserIds.push(memberId);
      lastSeenByUserId[memberId] = snapshot.lastSeen;
    }

    const joined: TripJoinedPayload = {
      tripId: payload.tripId,
      memberLocations: locations
        .filter(({ location }) => location !== null)
        .map(({ userId: memberId, location }) => ({
          userId: memberId,
          lat: location!.lat,
          lng: location!.lng,
          accuracy: location!.accuracy,
          updatedAt: location!.timestamp,
        })),
      presence: { onlineUserIds, lastSeenByUserId },
    };
    (socket as any).emit('trip:joined', joined);
  }

  @SubscribeMessage('trip:leave')
  @UsePipes(new ValidationPipe())
  async leaveTrip(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { tripId: string },
  ) {
    await socket.leave(`trip:${payload.tripId}`);
    const memberIds = await this.tripsRepository
      .memberIds(payload.tripId)
      .catch(() => []);
    for (const memberId of memberIds) {
      await socket.leave(`location:${memberId}`);
    }
  }

  @SubscribeMessage('trip:chat')
  @UsePipes(new ValidationPipe())
  async sendTripChat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: SendTripMessageDto,
  ) {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) return;

    if (await this.isMessageRateLimited(userId)) {
      socket.emit('trip:error', { message: 'rate-limited' });
      return;
    }

    const membership = await this.tripsRepository.findMember(payload.tripId, userId);
    if (!membership) {
      socket.emit('trip:error', { message: 'not-a-member' });
      return;
    }

    const body = payload.body.trim();
    if (!body) return;

    try {
      const message = await this.tripsRepository.saveTripMessage(
        payload.tripId,
        userId,
        body.slice(0, 2000),
      );
      this.emitTripMessage(message as Message);
    } catch {
      socket.emit('trip:error', { message: 'failed-to-send' });
    }
  }

  @SubscribeMessage('trip:typing')
  @UsePipes(new ValidationPipe())
  async tripTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: TripTypingDto,
  ) {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) return;

    const key = `rate-limit:trip-typing:${userId}`;
    if (await this.redisThrottler.isRateLimited(key, 30, 60)) return;

    const membership = await this.tripsRepository.findMember(payload.tripId, userId);
    if (!membership) return;

    this.server.to(`trip:${payload.tripId}`).emit('trip:typing', {
      tripId: payload.tripId,
      userId,
      typing: payload.typing,
    });
  }

  emitTripUpdated(tripId: string) {
    this.server.to(`trip:${tripId}`).emit('trip:update', { tripId });
  }

  emitTripMessage(message: Message) {
    this.server.to(`trip:${message.tripId}`).emit('trip:chat-new', message);
  }

  emitMemberArrived(tripId: string, userId: string, arrivedAt: Date | null) {
    this.server
      .to(`trip:${tripId}`)
      .emit('trip:member-arrived', { tripId, userId, arrivedAt });
  }
}