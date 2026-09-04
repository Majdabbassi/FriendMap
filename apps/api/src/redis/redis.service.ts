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