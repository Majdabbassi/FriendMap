import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LocationHistoryPoint } from '@prisma/client';

type LocationPoint = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
};

@Injectable()
export class LocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createHistoryPoint(
    userId: string,
    location: LocationPoint,
    expiresAt: Date,
  ): Promise<LocationHistoryPoint> {
    return this.prisma.locationHistoryPoint.create({
      data: {
        userId,
        lat: location.lat,
        lng: location.lng,
        accuracy: location.accuracy,
        recordedAt: new Date(location.timestamp),
        expiresAt,
      },
    });
  }

  async findHistoryByUserId(
    userId: string,
    startTime?: Date,
    endTime?: Date,
  ): Promise<LocationHistoryPoint[]> {
    const where: any = { userId };

    if (startTime || endTime) {
      where.recordedAt = {};
      if (startTime) where.recordedAt.gte = startTime;
      if (endTime) where.recordedAt.lte = endTime;
    }

    return this.prisma.locationHistoryPoint.findMany({
      where,
      orderBy: { recordedAt: 'asc' },
    });
  }

  async deleteExpiredHistory(): Promise<{ count: number }> {
    const result = await this.prisma.locationHistoryPoint.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return { count: result.count };
  }

  async deleteHistoryByUserId(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.locationHistoryPoint.deleteMany({
      where: { userId },
    });
    return { count: result.count };
  }

  async batchCreateHistoryPoints(
    points: Array<{
      userId: string;
      location: LocationPoint;
      expiresAt: Date;
    }>,
  ): Promise<LocationHistoryPoint[]> {
    return this.prisma.locationHistoryPoint.createMany({
      data: points.map((point) => ({
        userId: point.userId,
        lat: point.location.lat,
        lng: point.location.lng,
        accuracy: point.location.accuracy,
        recordedAt: new Date(point.location.timestamp),
        expiresAt: point.expiresAt,
      })),
      skipDuplicates: true,
    }) as any;
  }

  async findLatestPoint(userId: string): Promise<LocationHistoryPoint | null> {
    return this.prisma.locationHistoryPoint.findFirst({
      where: { userId },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async countHistoryPoints(userId: string): Promise<number> {
    return this.prisma.locationHistoryPoint.count({
      where: { userId },
    });
  }
}
