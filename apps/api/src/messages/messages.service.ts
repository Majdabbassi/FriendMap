import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FriendshipsRepository } from '../friendships/friendships.repository';
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
    private readonly friendshipsRepository: FriendshipsRepository,
    private readonly presenceService: PresenceService,
  ) {}

  async send(userId: string, dto: SendMessageDto) {
    if (userId === dto.recipientId) {
      throw new BadRequestException('Cannot send a message to yourself');
    }

    const body = dto.body?.trim();
    if (!body && !dto.imageUrl) {
      throw new BadRequestException(
        'A message needs text, an image, or both',
      );
    }

    const areFriends = await this.friendshipsService.areAcceptedFriends(
      userId,
      dto.recipientId,
    );
    if (!areFriends) {
      throw new ForbiddenException('You can only message accepted friends');
    }

    return this.messagesRepository.save(
      userId,
      dto.recipientId,
      body ?? null,
      dto.imageUrl,
    );
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

    const presenceSnapshots = await this.presenceService.getManySnapshots(
      conversations.map((c) => c.friendId),
    );

    return conversations.map((conversation) => ({
      ...conversation,
      friendOnline: presenceSnapshots.get(conversation.friendId)?.online ?? false,
      friendLastSeen:
        presenceSnapshots.get(conversation.friendId)?.lastSeen ?? null,
    }));
  }

  async searchMessages(userId: string, query: string, friendId?: string) {
    const acceptedFriendIds =
      await this.friendshipsRepository.findAcceptedFriendIds(userId);

    if (friendId) {
      if (!acceptedFriendIds.includes(friendId)) {
        throw new ForbiddenException(
          'You can only search conversations with accepted friends',
        );
      }
      return this.messagesRepository.searchMessages(userId, query, [friendId]);
    }

    return this.messagesRepository.searchMessages(userId, query, acceptedFriendIds);
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.messagesRepository.findMessageById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (message.senderId !== userId && message.recipientId !== userId) {
      throw new ForbiddenException('You are not part of this message');
    }
    if (message.deletedAt) return message;

    return this.messagesRepository.softDelete(messageId);
  }

  async clearConversation(userId: string, friendId: string) {
    const areFriends = await this.friendshipsService.areAcceptedFriends(
      userId,
      friendId,
    );
    if (!areFriends) {
      throw new ForbiddenException(
        'You can only clear conversations with accepted friends',
      );
    }

    const deletedCount = await this.messagesRepository.softDeleteConversation(
      userId,
      friendId,
    );
    return { friendId, deletedCount };
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