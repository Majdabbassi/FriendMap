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
    image?: { imageContentType: string; imageData: string } | undefined,
  ): Promise<Message> {
    return this.prisma.message.create({
      data: {
        senderId,
        recipientId,
        body,
        ...(image
          ? { imageContentType: image.imageContentType, imageData: image.imageData }
          : {}),
      },
    });
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
      where: { recipientId: userId, readAt: null },
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