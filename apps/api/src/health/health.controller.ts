import { Controller, Get } from '@nestjs/common';
import { 
  HealthCheck, 
  HealthCheckService, 
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.checkDatabase(),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
      () => this.disk.checkStorage('storage', { path: process.cwd(), thresholdPercent: 0.9 }),
      () => this.checkRedis(),
    ]);
  }

  private async checkDatabase() {
    await this.prisma.$executeRaw`SELECT 1`;
    return { database: { status: 'up' } } as const;
  }

  private async checkRedis() {
    await this.redis.getIoRedisClient().ping();
    return { redis: { status: 'up' } } as const;
  }
}
