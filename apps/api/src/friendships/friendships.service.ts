import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FriendshipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateFriendshipRequestDto } from './dto/create-friendship-request.dto';
import { hasBlockingFriendship, loadFriendshipsBetween } from './friendships.utils';

const publicUserSelect = {
  id: true,
  username: true,
  email: true,
} as const;

@Injectable()
export class FriendshipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async request(userId: string, dto: CreateFriendshipRequestDto) {
    if (!dto.targetEmail && !dto.targetUsername) {
      throw new BadRequestException(
        'either targetEmail or targetUsername must be provided',
      );
    }

    const target = dto.targetEmail
      ? await this.usersService.findByEmail(dto.targetEmail)
      : await this.usersService.findByUsername(dto.targetUsername as string);

    if (!target) {
      throw new NotFoundException('User not found');
    }

    if (target.id === userId) {
      throw new BadRequestException('Cannot send a friend request to yourself');
    }

    const existing = await loadFriendshipsBetween(
      this.prisma,
      userId,
      target.id,
    );

    if (hasBlockingFriendship(existing, userId, target.id)) {
      const blockingFriendship = existing.find(
        (row) =>
          row.status === FriendshipStatus.PENDING ||
          row.status === FriendshipStatus.ACCEPTED,
      );
      const message =
        blockingFriendship?.status === FriendshipStatus.PENDING
          ? 'Friend request already pending'
          : 'You are already friends with this user';
      throw new ConflictException(message);
    }

    const includeAddressee = {
      addressee: { select: publicUserSelect },
    };

    const sameDirectionRejected = existing.find(
      (row) =>
        row.requesterId === userId &&
        row.addresseeId === target.id &&
        row.status === FriendshipStatus.REJECTED,
    );
    if (sameDirectionRejected) {
      return this.prisma.friendship.update({
        where: { id: sameDirectionRejected.id },
        data: { status: FriendshipStatus.PENDING },
        include: includeAddressee,
      });
    }

    return this.prisma.friendship.create({
      data: {
        requesterId: userId,
        addresseeId: target.id,
      },
      include: includeAddressee,
    });
  }

  async accept(userId: string, friendshipId: string) {
    const friendship = await this.findFriendshipOrThrow(friendshipId);

    if (friendship.addresseeId !== userId) {
      throw new ForbiddenException('Only the addressee can accept this request');
    }

    if (friendship.status !== FriendshipStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be accepted');
    }

    return this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: FriendshipStatus.ACCEPTED },
      include: {
        requester: { select: publicUserSelect },
      },
    });
  }

  async reject(userId: string, friendshipId: string) {
    const friendship = await this.findFriendshipOrThrow(friendshipId);

    if (friendship.addresseeId !== userId) {
      throw new ForbiddenException('Only the addressee can reject this request');
    }

    if (friendship.status !== FriendshipStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be rejected');
    }

    await this.prisma.friendship.delete({ where: { id: friendshipId } });
    return { deleted: true };
  }

  async unfriend(userId: string, friendshipId: string) {
    const friendship = await this.findFriendshipOrThrow(friendshipId);

    if (
      friendship.requesterId !== userId &&
      friendship.addresseeId !== userId
    ) {
      throw new ForbiddenException('You are not part of this friendship');
    }

    if (friendship.status !== FriendshipStatus.ACCEPTED) {
      throw new BadRequestException('Only accepted friendships can be removed');
    }

    const { requesterId, addresseeId } = friendship;

    await this.prisma.$transaction(async (tx) => {
      await tx.sharingListEntry.deleteMany({
        where: {
          OR: [
            { ownerId: requesterId, friendId: addresseeId },
            { ownerId: addresseeId, friendId: requesterId },
          ],
        },
      });
      await tx.friendship.delete({ where: { id: friendshipId } });
    });

    this.eventEmitter.emit('friendship.removed', {
      userAId: requesterId,
      userBId: addresseeId,
    });
  }

  async listAccepted(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: publicUserSelect },
        addressee: { select: publicUserSelect },
      },
    });

    return friendships.map((friendship) => ({
      id: friendship.id,
      status: friendship.status,
      createdAt: friendship.createdAt,
      friend:
        friendship.requesterId === userId
          ? friendship.addressee
          : friendship.requester,
    }));
  }

  async listIncomingPending(userId: string) {
    return this.prisma.friendship.findMany({
      where: {
        addresseeId: userId,
        status: FriendshipStatus.PENDING,
      },
      include: {
        requester: { select: publicUserSelect },
      },
    });
  }

  private async findFriendshipOrThrow(id: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id },
    });
    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }
    return friendship;
  }
}
