import { Injectable } from '@nestjs/common';
import {
  FriendshipStatus,
  SharingListType,
  SharingMode,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async canView(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) {
      return false;
    }

    const friendship = await this.prisma.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: viewerId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: viewerId },
        ],
      },
    });
    if (!friendship) {
      return false;
    }

    const settings = await this.prisma.sharingSettings.findUnique({
      where: { userId: targetId },
    });
    const mode = settings?.mode ?? SharingMode.EVERYONE;

    if (mode === SharingMode.GHOST) {
      return false;
    }
    if (mode === SharingMode.EVERYONE) {
      return true;
    }

    const listType =
      mode === SharingMode.SELECTED
        ? SharingListType.SELECTED
        : SharingListType.EXCEPT;
    const entry = await this.prisma.sharingListEntry.findUnique({
      where: {
        ownerId_friendId_listType: {
          ownerId: targetId,
          friendId: viewerId,
          listType,
        },
      },
    });

    return mode === SharingMode.SELECTED ? entry !== null : entry === null;
  }
}