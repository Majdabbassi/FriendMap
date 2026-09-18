import { Injectable } from '@nestjs/common';
import {
  SharingListType,
  SharingMode,
} from '@prisma/client';
import { FriendshipsRepository } from '../friendships/friendships.repository';
import { SharingRepository } from './sharing.repository';

@Injectable()
export class VisibilityService {
  constructor(
    private readonly friendshipsRepository: FriendshipsRepository,
    private readonly sharingRepository: SharingRepository,
  ) {}

  async canView(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) {
      return false;
    }

    const friendships = await this.friendshipsRepository.findBetweenUsers(
      viewerId,
      targetId,
    );
    const friendship = friendships.find(
      (f) => f.status === 'ACCEPTED',
    );
    if (!friendship) {
      return false;
    }

    const mode = await this.sharingRepository.getModeOrDefault(targetId);

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
    const entry = await this.sharingRepository.findListEntry(
      targetId,
      viewerId,
      listType,
    );

    return mode === SharingMode.SELECTED ? entry !== null : entry === null;
  }

  async canViewMany(viewerId: string, targetIds: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    
    const friendshipsMap = await this.friendshipsRepository.batchFindFriendIds(
      [viewerId, ...targetIds],
    );
    
    const viewerFriends = friendshipsMap.get(viewerId) || [];
    const settingsMap = await this.sharingRepository.batchFindSettings(targetIds);
    
    for (const targetId of targetIds) {
      if (viewerId === targetId) {
        result.set(targetId, false);
        continue;
      }
      
      const isFriend = viewerFriends.includes(targetId);
      if (!isFriend) {
        result.set(targetId, false);
        continue;
      }
      
      const settings = settingsMap.get(targetId);
      const mode = settings?.mode ?? SharingMode.GHOST;
      
      if (mode === SharingMode.GHOST) {
        result.set(targetId, false);
        continue;
      }
      
      if (mode === SharingMode.EVERYONE) {
        result.set(targetId, true);
        continue;
      }
      
      const listType =
        mode === SharingMode.SELECTED
          ? SharingListType.SELECTED
          : SharingListType.EXCEPT;
      
      const entry = await this.sharingRepository.findListEntry(
        targetId,
        viewerId,
        listType,
      );
      
      result.set(targetId, mode === SharingMode.SELECTED ? entry !== null : entry === null);
    }
    
    return result;
  }
}