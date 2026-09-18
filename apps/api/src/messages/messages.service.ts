import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FriendshipsService } from '../friendships/friendships.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesRepository } from './messages.repository';
import { PresenceService } from './presence.service';

export type ConversationQuery = {
  before?: string;
  limit?: number;
};

@Injectable()
export class MessagesService {
  constructor(
    private readonly messagesRepository: MessagesRepository,
    private readonly friendshipsService: FriendshipsService,
    private readonly presenceService: PresenceService,
  ) {}

  async send(userId: string, dto: SendMessageDto) {
    if (userId === dto.recipientId) {
      throw new BadRequestException('Cannot send a message to yourself');
    }

    const areFriends = await this.friendshipsService.areAcceptedFriends(
      userId,
      dto.recipientId,
    );
    if (!areFriends) {
      throw new ForbiddenException('You can only message accepted friends');
    }

    return this.messagesRepository.save(userId, dto.recipientId, dto.body);
  }

  async conversation(userId: string, friendId: string, query: ConversationQuery = {}) {
    const areFriends = await this.friendshipsService.areAcceptedFriends(
      userId,
      friendId,
    );
    if (!areFriends) {
      throw new ForbiddenException('You can only view conversations with accepted friends');
    }

    const limit = this.clampLimit(query.limit);
    let beforeDate: Date | undefined;
    if (query.before) {
      const cursor = await this.messagesRepository.findMessageById(query.before);
      if (!cursor) {
        throw new NotFoundException('Message not found');
      }
      beforeDate = cursor.createdAt;
    }

    const rows = await this.messagesRepository.findConversation(
      userId,
      friendId,
      beforeDate,
      limit,
    );
    return rows.reverse();
  }

  async conversations(userId: string) {
    const conversations = await this.messagesRepository.listConversations(userId);

    const onlinePresence = await this.presenceService.getManyPresence(
      conversations.map((c) => c.friendId),
    );

    return conversations.map((conversation) => ({
      ...conversation,
      friendOnline: onlinePresence.get(conversation.friendId) ?? false,
    }));
  }

  async markConversationRead(userId: string, senderId: string) {
    const areFriends = await this.friendshipsService.areAcceptedFriends(
      userId,
      senderId,
    );
    if (!areFriends) {
      throw new ForbiddenException('You can only read conversations with accepted friends');
    }

    await this.messagesRepository.markAllRead(senderId, userId);
    return { senderId, readAt: new Date() };
  }

  async getUnreadCount(userId: string): Promise<number> {
    const conversations = await this.messagesRepository.listConversations(userId);
    return conversations.reduce((total, c) => total + c.unreadCount, 0);
  }

  private clampLimit(value: number | undefined): number {
    if (value === undefined) return 50;
    if (!Number.isInteger(value) || value < 1) return 50;
    return Math.min(value, 100);
  }
}