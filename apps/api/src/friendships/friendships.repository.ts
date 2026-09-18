import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Friendship, FriendshipStatus, User } from '@prisma/client';
import { friendshipsBetweenWhere } from './friendships.utils';

const publicUserSelect = {
  id: true,
  username: true,
  email: true,
} as const;

type FriendshipWithUsers = Friendship & {
  requester: Pick<User, 'id' | 'username' | 'email'>;
  addressee: Pick<User, 'id' | 'username' | 'email'>;
};

@Injectable()
export class FriendshipsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Friendship | null> {
    return this.prisma.friendship.findUnique({
      where: { id },
    });
  }

  async findBetweenUsers(userAId: string, userBId: string): Promise<Friendship[]> {
    return this.prisma.friendship.findMany({
      where: friendshipsBetweenWhere(userAId, userBId),
    });
  }

  async findAcceptedForUser(userId: string): Promise<FriendshipWithUsers[]> {
    return this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: publicUserSelect },
        addressee: { select: publicUserSelect },
      },
    });
  }

  async findPendingForUser(userId: string): Promise<FriendshipWithUsers[]> {
    return this.prisma.friendship.findMany({
      where: {
        addresseeId: userId,
        status: FriendshipStatus.PENDING,
      },
      include: {
        requester: { select: publicUserSelect },
        addressee: { select: publicUserSelect },
      },
    });
  }

  async findAcceptedFriendIds(userId: string): Promise<string[]> {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: {
        requesterId: true,
        addresseeId: true,
      },
    });

    return friendships.map((friendship) =>
      friendship.requesterId === userId
        ? friendship.addresseeId
        : friendship.requesterId,
    );
  }

  async create(requesterId: string, addresseeId: string): Promise<FriendshipWithUsers> {
    return this.prisma.friendship.create({
      data: {
        requesterId,
        addresseeId,
      },
      include: {
        requester: { select: publicUserSelect },
        addressee: { select: publicUserSelect },
      },
    });
  }

  async updateStatus(id: string, status: FriendshipStatus): Promise<FriendshipWithUsers> {
    return this.prisma.friendship.update({
      where: { id },
      data: { status },
      include: {
        requester: { select: publicUserSelect },
        addressee: { select: publicUserSelect },
      },
    });
  }

  async delete(id: string): Promise<Friendship> {
    return this.prisma.friendship.delete({
      where: { id },
    });
  }

  async deleteSharingListEntries(userAId: string, userBId: string): Promise<void> {
    await this.prisma.sharingListEntry.deleteMany({
      where: {
        OR: [
          { ownerId: userAId, friendId: userBId },
          { ownerId: userBId, friendId: userAId },
        ],
      },
    });
  }

  async deleteFriendshipAndSharingEntries(friendshipId: string, userAId: string, userBId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.sharingListEntry.deleteMany({
        where: {
          OR: [
            { ownerId: userAId, friendId: userBId },
            { ownerId: userBId, friendId: userAId },
          ],
        },
      }),
      this.prisma.friendship.delete({
        where: { id: friendshipId },
      }),
    ]);
  }

  async batchFindFriendIds(userIds: string[]): Promise<Map<string, string[]>> {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: { in: userIds } },
          { addresseeId: { in: userIds } },
        ],
      },
      select: {
        requesterId: true,
        addresseeId: true,
      },
    });

    const friendMap = new Map<string, string[]>();
    userIds.forEach((id) => friendMap.set(id, []));

    friendships.forEach((friendship) => {
      const requesterFriends = friendMap.get(friendship.requesterId);
      const addresseeFriends = friendMap.get(friendship.addresseeId);

      if (requesterFriends) {
        requesterFriends.push(friendship.addresseeId);
      }
      if (addresseeFriends) {
        addresseeFriends.push(friendship.requesterId);
      }
    });

    return friendMap;
  }
}
