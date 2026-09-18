import { Injectable } from '@nestjs/common';
import { Message } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type Conversation = {
  friendId: string;
  friendUsername: string;
  friendEmail: string;
  lastMessage: Message | null;
  unreadCount: number;
};

const publicUserSelect = {
  id: true,
  username: true,
  email: true,
} as const;

type PublicUser = { id: string; username: string; email: string };

type MessageWithParties = Message & {
  sender: PublicUser;
  recipient: PublicUser;
};

@Injectable()
export class MessagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMessageById(id: string): Promise<Message | null> {
    return this.prisma.message.findUnique({ where: { id } });
  }

  async findConversation(
    userAId: string,
    userBId: string,
    before?: Date,
    limit = 50,
  ): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: {
        OR: [
          { senderId: userAId, recipientId: userBId },
          { senderId: userBId, recipientId: userAId },
        ],
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async save(
    senderId: string,
    recipientId: string,
    body: string | null,
    imageUrl?: string | null,
  ): Promise<Message> {
    return this.prisma.message.create({
      data: {
        senderId,
        recipientId,
        body,
        ...(imageUrl ? { imageUrl } : {}),
      },
    });
  }

  async searchMessages(
    userId: string,
    query: string,
    friendIds: string[],
    limit = 50,
  ): Promise<Message[]> {
    if (friendIds.length === 0) return [];
    return this.prisma.message.findMany({
      where: {
        deletedAt: null,
        body: { contains: query, mode: 'insensitive' },
        OR: [
          { senderId: userId, recipientId: { in: friendIds } },
          { senderId: { in: friendIds }, recipientId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async softDelete(id: string, deletedAt = new Date()): Promise<Message> {
    return this.prisma.message.update({
      where: { id },
      data: { deletedAt },
    });
  }

  async softDeleteConversation(userAId: string, userBId: string): Promise<number> {
    const result = await this.prisma.message.updateMany({
      where: {
        OR: [
          { senderId: userAId, recipientId: userBId },
          { senderId: userBId, recipientId: userAId },
        ],
      },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  async markAllRead(fromUserId: string, toUserId: string): Promise<number> {
    const result = await this.prisma.message.updateMany({
      where: {
        senderId: fromUserId,
        recipientId: toUserId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    const raw = await this.prisma.message.findMany({
      where: {
        deletedAt: null,
        OR: [{ senderId: userId }, { recipientId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: publicUserSelect },
        recipient: { select: publicUserSelect },
      },
    }) satisfies MessageWithParties[];

    const latestByFriend = new Map<string, MessageWithParties>();
    for (const message of raw) {
      const friendId =
        message.senderId === userId ? message.recipientId : message.senderId;
      if (!latestByFriend.has(friendId)) {
        latestByFriend.set(friendId, message);
      }
    }

    const unreadRows = await this.prisma.message.groupBy({
      by: ['senderId'],
      where: { recipientId: userId, readAt: null, deletedAt: null },
      _count: { _all: true },
    });
    const unreadBySender = new Map(
      unreadRows.map((row) => [row.senderId, row._count._all]),
    );

    return [...latestByFriend.entries()].map(([friendId, lastMessage]) => {
      const friend =
        lastMessage.senderId === friendId
          ? lastMessage.sender
          : lastMessage.recipient;
      return {
        friendId,
        friendUsername: friend.username,
        friendEmail: friend.email,
        lastMessage,
        unreadCount: unreadBySender.get(friendId) ?? 0,
      };
    });
  }
}