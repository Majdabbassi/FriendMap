import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  HistoryQueuePoint,
  RedisService,
} from '../redis/redis.service';
import { randomUUID } from 'node:crypto';

const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const HISTORY_SAMPLE_INTERVAL_MS = 30_000;
const HISTORY_DISTANCE_METERS = 25;
const HISTORY_BATCH_SIZE = 250;
const HISTORY_WORKER_INTERVAL_MS = 1_000;
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
  private worker?: ReturnType<typeof setInterval>;
  private draining = false;
  private lastCleanupAt = 0;
  private readonly workerId = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    this.worker = setInterval(() => void this.flushQueue(), HISTORY_WORKER_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.worker) clearInterval(this.worker);
  }

  async enqueueIfSampled(userId: string, point: AcceptedPoint) {
    const checkpoint = await this.redis.getHistoryCheckpoint(userId);
    if (checkpoint && !this.shouldSample(checkpoint, point)) return;

    await this.redis.setHistoryCheckpoint(userId, {
      lat: point.lat,
      lng: point.lng,
      timestamp: point.timestamp,
    });
    await this.redis.enqueueHistoryPoint({
      id: randomUUID(),
      userId,
      lat: point.lat,
      lng: point.lng,
      accuracy: point.accuracy ?? 0,
      timestamp: point.timestamp,
      expiresAt: Date.now() + HISTORY_RETENTION_MS,
    });
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

  private shouldSample(checkpoint: { lat: number; lng: number; timestamp: number }, point: AcceptedPoint) {
    return (
      point.timestamp - checkpoint.timestamp >= HISTORY_SAMPLE_INTERVAL_MS ||
      this.distanceMeters(checkpoint.lat, checkpoint.lng, point.lat, point.lng) >= HISTORY_DISTANCE_METERS
    );
  }

  private async flushQueue() {
    if (this.draining) return;
    if (!(await this.redis.acquireHistoryFlushLock(this.workerId))) return;
    this.draining = true;
    try {
      const points = await this.redis.peekHistoryPoints(HISTORY_BATCH_SIZE);
      if (points.length) {
        await this.prisma.locationHistoryPoint.createMany({
          data: points.map((point) => ({
            id: point.id,
            userId: point.userId,
            lat: point.lat,
            lng: point.lng,
            accuracy: point.accuracy,
            recordedAt: new Date(point.timestamp),
            expiresAt: new Date(point.expiresAt),
          })),
          skipDuplicates: true,
        });
        await this.redis.removeHistoryPoints(points.length);
      }
      if (Date.now() - this.lastCleanupAt >= HISTORY_CLEANUP_INTERVAL_MS) {
        await this.prisma.locationHistoryPoint.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
        this.lastCleanupAt = Date.now();
      }
    } catch (error) {
      this.logger.error('Failed to flush location history queue', error);
    } finally {
      this.draining = false;
      await this.redis.releaseHistoryFlushLock(this.workerId);
    }
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