import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SharingMode, SharingListType, SharingSettings, SharingListEntry } from '@prisma/client';

@Injectable()
export class SharingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSettingsByUserId(userId: string): Promise<SharingSettings | null> {
    return this.prisma.sharingSettings.findUnique({
      where: { userId },
    });
  }

  async createSettings(userId: string, mode: SharingMode = SharingMode.GHOST): Promise<SharingSettings> {
    return this.prisma.sharingSettings.create({
      data: { userId, mode },
    });
  }

  async updateSettings(userId: string, mode: SharingMode): Promise<SharingSettings> {
    return this.prisma.sharingSettings.upsert({
      where: { userId },
      create: { userId, mode },
      update: { mode },
    });
  }

  async findListEntry(ownerId: string, friendId: string, listType: SharingListType): Promise<SharingListEntry | null> {
    return this.prisma.sharingListEntry.findUnique({
      where: {
        ownerId_friendId_listType: {
          ownerId,
          friendId,
          listType,
        },
      },
    });
  }

  async findListEntriesByOwner(ownerId: string, listType: SharingListType): Promise<SharingListEntry[]> {
    return this.prisma.sharingListEntry.findMany({
      where: { ownerId, listType },
    });
  }

  async createListEntry(ownerId: string, friendId: string, listType: SharingListType): Promise<SharingListEntry> {
    return this.prisma.sharingListEntry.create({
      data: { ownerId, friendId, listType },
    });
  }

  async deleteListEntry(ownerId: string, friendId: string, listType: SharingListType): Promise<SharingListEntry> {
    return this.prisma.sharingListEntry.delete({
      where: {
        ownerId_friendId_listType: {
          ownerId,
          friendId,
          listType,
        },
      },
    });
  }

  async deleteListEntriesByOwner(ownerId: string): Promise<void> {
    await this.prisma.sharingListEntry.deleteMany({
      where: { ownerId },
    });
  }

  async deleteListEntriesForFriend(ownerId: string, friendId: string): Promise<void> {
    await this.prisma.sharingListEntry.deleteMany({
      where: {
        ownerId,
        friendId,
      },
    });
  }

  async batchFindListEntries(
    ownerId: string,
    friendIds: string[],
    listType: SharingListType,
  ): Promise<Map<string, SharingListEntry | null>> {
    const entries = await this.prisma.sharingListEntry.findMany({
      where: {
        ownerId,
        friendId: { in: friendIds },
        listType,
      },
    });

    const entryMap = new Map<string, SharingListEntry | null>();
    friendIds.forEach((friendId) => entryMap.set(friendId, null));

    entries.forEach((entry) => {
      entryMap.set(entry.friendId, entry);
    });

    return entryMap;
  }

  async batchFindSettings(userIds: string[]): Promise<Map<string, SharingSettings | null>> {
    const settings = await this.prisma.sharingSettings.findMany({
      where: {
        userId: { in: userIds },
      },
    });

    const settingsMap = new Map<string, SharingSettings | null>();
    userIds.forEach((userId) => settingsMap.set(userId, null));

    settings.forEach((setting) => {
      settingsMap.set(setting.userId, setting);
    });

    return settingsMap;
  }

  async getModeOrDefault(userId: string): Promise<SharingMode> {
    const settings = await this.findSettingsByUserId(userId);
    return settings?.mode ?? SharingMode.GHOST;
  }
}
