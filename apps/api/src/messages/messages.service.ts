import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FriendshipsService } from '../friendships/friendships.service';
import { decodeImage, sniffImageType } from './image-validator';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesRepository } from './messages.repository';
import { PresenceService } from './presence.service';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

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

    const body = dto.body?.trim();
    const image = dto.imageData
      ? this.validateImage(dto.imageData, dto.imageContentType)
      : undefined;

    if (!body && !image) {
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
      image,
    );
  }

  private validateImage(
    imageData: string,
    contentType: string | undefined,
  ): { imageContentType: string; imageData: string } {
    if (!contentType) {
      throw new BadRequestException('Image content type is required');
    }

    let buffer: Buffer;
    try {
      buffer = decodeImage(imageData);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid image data',
      );
    }
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        'Image must be between 1 byte and 3 MB after decoding',
      );
    }

    const sniffed = sniffImageType(buffer);
    if (sniffed !== contentType) {
      throw new BadRequestException(
        'Unsupported or mismatched image type: only PNG, JPEG, GIF, and WebP are allowed',
      );
    }

    return { imageContentType: sniffed, imageData };
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