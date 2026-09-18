import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FriendshipStatus } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { CreateFriendshipRequestDto } from './dto/create-friendship-request.dto';
import { FriendshipsRepository } from './friendships.repository';
import { hasBlockingFriendship } from './friendships.utils';

@Injectable()
export class FriendshipsService {
  constructor(
    private readonly friendshipsRepository: FriendshipsRepository,
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

    const existing = await this.friendshipsRepository.findBetweenUsers(
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

    return this.friendshipsRepository.create(userId, target.id);
  }

  async accept(userId: string, friendshipId: string) {
    const friendship = await this.findFriendshipOrThrow(friendshipId);

    if (friendship.addresseeId !== userId) {
      throw new ForbiddenException('Only the addressee can accept this request');
    }

    if (friendship.status !== FriendshipStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be accepted');
    }

    return this.friendshipsRepository.updateStatus(
      friendshipId,
      FriendshipStatus.ACCEPTED,
    );
  }

  async reject(userId: string, friendshipId: string) {
    const friendship = await this.findFriendshipOrThrow(friendshipId);

    if (friendship.addresseeId !== userId) {
      throw new ForbiddenException('Only the addressee can reject this request');
    }

    if (friendship.status !== FriendshipStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be rejected');
    }

    await this.friendshipsRepository.delete(friendshipId);
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

    await this.friendshipsRepository.deleteFriendshipAndSharingEntries(
      friendshipId,
      requesterId,
      addresseeId,
    );

    this.eventEmitter.emit('friendship.removed', {
      userAId: requesterId,
      userBId: addresseeId,
    });
  }

  async listAccepted(userId: string) {
    const friendships = await this.friendshipsRepository.findAcceptedForUser(userId);

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

  async areAcceptedFriends(userAId: string, userBId: string): Promise<boolean> {
    if (userAId === userBId) return false;
    const friendships = await this.friendshipsRepository.findBetweenUsers(
      userAId,
      userBId,
    );
    return friendships.some(
      (friendship) => friendship.status === FriendshipStatus.ACCEPTED,
    );
  }

  async listIncomingPending(userId: string) {
    return this.friendshipsRepository.findPendingForUser(userId);
  }

  private async findFriendshipOrThrow(id: string) {
    const friendship = await this.friendshipsRepository.findById(id);
    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }
    return friendship;
  }
}
