import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export type PresenceSnapshot = {
  online: boolean;
  lastSeen: number;
};

const PRESENCE_TTL_SECONDS = 90;

@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  async setOnline(userId: string): Promise<void> {
    await this.writePresence(userId, { online: true, lastSeen: Date.now() });
  }

  async setOffline(userId: string): Promise<void> {
    await this.writePresence(userId, { online: false, lastSeen: Date.now() });
  }

  async isOnline(userId: string): Promise<boolean> {
    const presence = await this.getPresence(userId);
    return presence?.online ?? false;
  }

  async getPresence(userId: string): Promise<PresenceSnapshot | null> {
    const raw = await this.redis.getIoRedisClient().get(this.presenceKey(userId));
    return raw ? (JSON.parse(raw) as PresenceSnapshot) : null;
  }

  async getManyPresence(userIds: string[]): Promise<Map<string, boolean>> {
    if (userIds.length === 0) return new Map();
    const client = this.redis.getIoRedisClient();
    const values = await client.mget(userIds.map((id) => this.presenceKey(id)));
    const result = new Map<string, boolean>();
    userIds.forEach((id, index) => {
      const raw = values[index];
      result.set(id, raw ? (JSON.parse(raw) as PresenceSnapshot).online : false);
    });
    return result;
  }

  async listOnlineUserIds(userIds: string[]): Promise<string[]> {
    const presence = await this.getManyPresence(userIds);
    return userIds.filter((id) => presence.get(id) === true);
  }

  private async writePresence(userId: string, presence: PresenceSnapshot): Promise<void> {
    await this.redis
      .getIoRedisClient()
      .set(this.presenceKey(userId), JSON.stringify(presence), 'EX', PRESENCE_TTL_SECONDS);
  }

  private presenceKey(userId: string): string {
    return `presence:${userId}`;
  }
}