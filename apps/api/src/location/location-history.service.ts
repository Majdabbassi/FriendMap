import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { randomUUID } from 'node:crypto';

const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const HISTORY_SAMPLE_INTERVAL_MS = 30_000;
const HISTORY_DISTANCE_METERS = 25;
const HISTORY_CLEANUP_INTERVAL_MS = 15 * 60_000;

type AcceptedPoint = {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: number;
};

@Injectable()
export class LocationHistoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LocationHistoryService.name);
  private cleanupWorker?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    this.cleanupWorker = setInterval(
      () => void this.cleanupExpired(),
      HISTORY_CLEANUP_INTERVAL_MS,
    );
  }

  onModuleDestroy() {
    if (this.cleanupWorker) clearInterval(this.cleanupWorker);
  }

  async enqueueIfSampled(userId: string, point: AcceptedPoint) {
    const checkpoint = await this.redis.getHistoryCheckpoint(userId);
    if (checkpoint && !this.shouldSample(checkpoint, point)) return;

    await this.redis.setHistoryCheckpoint(userId, {
      lat: point.lat,
      lng: point.lng,
      timestamp: point.timestamp,
    });

    try {
      await this.prisma.locationHistoryPoint.create({
        data: {
          id: randomUUID(),
          userId,
          lat: point.lat,
          lng: point.lng,
          accuracy: point.accuracy,
          recordedAt: new Date(point.timestamp),
          expiresAt: new Date(Date.now() + HISTORY_RETENTION_MS),
        },
      });
    } catch (error) {
      this.logger.error('Failed to write location history point', error);
    }
  }

  async getHistory(userId: string, from?: Date, to?: Date) {
    const now = Date.now();
    const end = to?.getTime() ?? now;
    const start = from?.getTime() ?? end - HISTORY_RETENTION_MS;
    if (start > end) throw new BadRequestException('from must be before to');
    if (end > now) throw new BadRequestException('History cannot include future points');
    if (end - start > HISTORY_RETENTION_MS) {
      throw new BadRequestException('History range cannot exceed 24 hours');
    }

    const points = await this.prisma.locationHistoryPoint.findMany({
      where: {
        userId,
        recordedAt: { gte: new Date(start), lte: new Date(end) },
        expiresAt: { gt: new Date() },
      },
      orderBy: { recordedAt: 'asc' },
      select: { lat: true, lng: true, accuracy: true, recordedAt: true },
    });
    return { from: new Date(start), to: new Date(end), points };
  }

  private async cleanupExpired() {
    try {
      await this.prisma.locationHistoryPoint.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
    } catch (error) {
      this.logger.error('Failed to clean up expired location history points', error);
    }
  }

  private shouldSample(checkpoint: { lat: number; lng: number; timestamp: number }, point: AcceptedPoint) {
    return (
      point.timestamp - checkpoint.timestamp >= HISTORY_SAMPLE_INTERVAL_MS ||
      this.distanceMeters(checkpoint.lat, checkpoint.lng, point.lat, point.lng) >= HISTORY_DISTANCE_METERS
    );
  }

  private distanceMeters(firstLat: number, firstLng: number, secondLat: number, secondLng: number) {
    const earthRadiusMeters = 6_371_000;
    const latDelta = ((secondLat - firstLat) * Math.PI) / 180;
    const lngDelta = ((secondLng - firstLng) * Math.PI) / 180;
    const firstLatitude = (firstLat * Math.PI) / 180;
    const secondLatitude = (secondLat * Math.PI) / 180;
    const a = Math.sin(latDelta / 2) ** 2 +
      Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(lngDelta / 2) ** 2;
    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
