import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export type CurrentLocation = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
};

export type HistoryCheckpoint = {
  lat: number;
  lng: number;
  timestamp: number;
};

export type HistoryQueuePoint = CurrentLocation & {
  id: string;
  userId: string;
  expiresAt: number;
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
  }

  async setCurrentLocation(userId: string, location: CurrentLocation) {
    await this.client.set(
      this.locationKey(userId),
      JSON.stringify(location),
      'EX',
      86400,
    );
  }

  async getCurrentLocation(userId: string): Promise<CurrentLocation | null> {
    const value = await this.client.get(this.locationKey(userId));
    return value ? (JSON.parse(value) as CurrentLocation) : null;
  }

  async enqueueHistoryPoint(point: HistoryQueuePoint) {
    await this.client.rpush('location-history:queue', JSON.stringify(point));
  }

  async peekHistoryPoints(limit: number): Promise<HistoryQueuePoint[]> {
    const values = await this.client.lrange('location-history:queue', 0, limit - 1);
    return values.map((value) => JSON.parse(value) as HistoryQueuePoint);
  }

  async removeHistoryPoints(count: number) {
    if (count > 0) await this.client.ltrim('location-history:queue', count, -1);
  }

  async acquireHistoryFlushLock(owner: string): Promise<boolean> {
    const result = await this.client.set('location-history:flush-lock', owner, 'PX', 5_000, 'NX');
    return result === 'OK';
  }

  async releaseHistoryFlushLock(owner: string) {
    const currentOwner = await this.client.get('location-history:flush-lock');
    if (currentOwner === owner) await this.client.del('location-history:flush-lock');
  }

  async getHistoryCheckpoint(userId: string): Promise<HistoryCheckpoint | null> {
    const value = await this.client.get(this.historyCheckpointKey(userId));
    return value ? (JSON.parse(value) as HistoryCheckpoint) : null;
  }

  async setHistoryCheckpoint(userId: string, checkpoint: HistoryCheckpoint) {
    await this.client.set(
      this.historyCheckpointKey(userId),
      JSON.stringify(checkpoint),
      'EX',
      86400,
    );
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  private locationKey(userId: string) {
    return `location:${userId}`;
  }

  private historyCheckpointKey(userId: string) {
    return `location-history:checkpoint:${userId}`;
  }
}