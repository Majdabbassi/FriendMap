import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  FriendshipStatus,
  SharingListType,
} from '@prisma/client';
import { UpdateSharingListDto } from './dto/update-sharing-list.dto';
import { UpdateSharingSettingsDto } from './dto/update-sharing-settings.dto';
import { SharingRepository } from './sharing.repository';
import { FriendshipsRepository } from '../friendships/friendships.repository';

@Injectable()
export class SharingService {
  constructor(
    private readonly sharingRepository: SharingRepository,
    private readonly friendshipsRepository: FriendshipsRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getSettings(userId: string) {
    const mode = await this.sharingRepository.getModeOrDefault(userId);
    return { mode };
  }

  async updateSettings(userId: string, dto: UpdateSharingSettingsDto) {
    const settings = await this.sharingRepository.updateSettings(userId, dto.mode);

    this.eventEmitter.emit('sharing.mode-changed', {
      userId,
      mode: settings.mode,
    });

    return settings;
  }

  async addToList(userId: string, dto: UpdateSharingListDto) {
    await this.assertAcceptedFriend(userId, dto.friendId);

    const entry = await this.sharingRepository.createListEntry(
      userId,
      dto.friendId,
      dto.listType,
    );

    this.eventEmitter.emit('sharing.list-changed', {
      ownerId: userId,
      friendId: dto.friendId,
      listType: dto.listType,
    });

    return entry;
  }

  async removeFromList(
    userId: string,
    friendId: string,
    listType: SharingListType,
  ) {
    await this.sharingRepository.deleteListEntry(userId, friendId, listType);

    this.eventEmitter.emit('sharing.list-changed', {
      ownerId: userId,
      friendId,
      listType,
    });
  }

  async getList(userId: string, type: SharingListType) {
    return this.sharingRepository.findListEntriesByOwner(userId, type);
  }

  private async assertAcceptedFriend(userId: string, friendId: string) {
    const friendships = await this.friendshipsRepository.findBetweenUsers(userId, friendId);
    const friendship = friendships.find(
      (f) => f.status === FriendshipStatus.ACCEPTED,
    );

    if (!friendship) {
      throw new ForbiddenException('Friend must be an accepted friend');
    }
  }
}