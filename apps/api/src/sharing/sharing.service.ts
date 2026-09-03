import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  FriendshipStatus,
  SharingListType,
  SharingMode,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSharingListDto } from './dto/update-sharing-list.dto';
import { UpdateSharingSettingsDto } from './dto/update-sharing-settings.dto';

@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getSettings(userId: string) {
    const settings = await this.prisma.sharingSettings.findUnique({
      where: { userId },
    });

    return { mode: settings?.mode ?? SharingMode.GHOST };
  }

  async updateSettings(userId: string, dto: UpdateSharingSettingsDto) {
    const settings = await this.prisma.sharingSettings.upsert({
      where: { userId },
      create: { userId, mode: dto.mode },
      update: { mode: dto.mode },
    });

    this.eventEmitter.emit('sharing.mode-changed', {
      userId,
      mode: settings.mode,
    });

    return settings;
  }

  async addToList(userId: string, dto: UpdateSharingListDto) {
    await this.assertAcceptedFriend(userId, dto.friendId);

    const entry = await this.prisma.sharingListEntry.upsert({
      where: {
        ownerId_friendId_listType: {
          ownerId: userId,
          friendId: dto.friendId,
          listType: dto.listType,
        },
      },
      create: {
        ownerId: userId,
        friendId: dto.friendId,
        listType: dto.listType,
      },
      update: {},
    });

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
    await this.prisma.sharingListEntry.deleteMany({
      where: { ownerId: userId, friendId, listType },
    });

    this.eventEmitter.emit('sharing.list-changed', {
      ownerId: userId,
      friendId,
      listType,
    });
  }

  async getList(userId: string, type: SharingListType) {
    return this.prisma.sharingListEntry.findMany({
      where: { ownerId: userId, listType: type },
      select: {
        friend: { select: { id: true, username: true } },
      },
    });
  }

  private async assertAcceptedFriend(userId: string, friendId: string) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: userId, addresseeId: friendId },
          { requesterId: friendId, addresseeId: userId },
        ],
      },
    });

    if (!friendship) {
      throw new ForbiddenException('Friend must be an accepted friend');
    }
  }
}