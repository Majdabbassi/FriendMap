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
import { FriendshipsRepository } from '../friendships/friendships.repository';
import { RedisThrottlerService } from '../throttling/redis-throttler.service';
import { MarkMessageReadDto } from './dto/mark-message-read.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';
import { PresenceService } from './presence.service';

type JwtPayload = { sub: string };

@WebSocketGateway({
  cors: {
    origin: corsOrigins(),
    credentials: true,
  },
  maxHttpBufferSize: 6_000_000,
})
export class MessagesGateway {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly messagesService: MessagesService,
    private readonly friendshipsRepository: FriendshipsRepository,
    private readonly presenceService: PresenceService,
    private readonly redisThrottler: RedisThrottlerService,
  ) {}

  private async isMessageRateLimited(userId: string): Promise<boolean> {
    const key = `rate-limit:message-send:${userId}`;
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
      await this.presenceService.setOnline(payload.sub);
      await this.broadcastPresence(payload.sub, true);
    } catch {
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket) {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) return;

    try {
      const remaining = await this.server.in(`user:${userId}`).fetchSockets();
      if (remaining.length > 0) return;
      await this.presenceService.setOffline(userId);
      await this.broadcastPresence(userId, false);
    } catch {
      // Graceful shutdown or adapter hiccup: presence TTL expires as backstop.
    }
  }

  @SubscribeMessage('message:send')
  @UsePipes(new ValidationPipe())
  async sendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: SendMessageDto,
  ) {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) return;

    if (await this.isMessageRateLimited(userId)) {
      socket.emit('message:error', { message: 'rate-limited' });
      return;
    }

    try {
      const message = await this.messagesService.send(userId, payload);
      (socket as any).emit('message:sent', message);
      this.server.to(`user:${message.recipientId}`).emit('message:new', message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'failed to send message';
      socket.emit('message:error', { message });
    }
  }

  @SubscribeMessage('message:read')
  @UsePipes(new ValidationPipe())
  async markRead(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: MarkMessageReadDto,
  ) {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) return;

    const key = `rate-limit:message-read:${userId}`;
    if (await this.redisThrottler.isRateLimited(key, 60, 60)) return;

    try {
      const receipt = await this.messagesService.markConversationRead(
        userId,
        payload.senderId,
      );
      this.server
        .to(`user:${payload.senderId}`)
        .emit('message:read', { senderId: userId, readAt: receipt.readAt });
    } catch {
      // Swallow unauthorized read attempts silently.
    }
  }

  @SubscribeMessage('presence:snapshot')
  async presenceSnapshot(@ConnectedSocket() socket: Socket) {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) return;

    const friendIds = await this.friendshipsRepository.findAcceptedFriendIds(userId);
    const onlineUserIds = await this.presenceService.listOnlineUserIds(friendIds);
    (socket as any).emit('presence:snapshot', { onlineUserIds });
  }

  private async broadcastPresence(userId: string, online: boolean) {
    const friendIds = await this.friendshipsRepository.findAcceptedFriendIds(userId);
    const lastSeen = Date.now();
    for (const friendId of friendIds) {
      this.server.to(`user:${friendId}`).emit('presence:update', {
        userId,
        online,
        lastSeen,
      });
    }
  }
}