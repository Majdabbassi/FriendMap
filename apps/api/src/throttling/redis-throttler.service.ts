import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisThrottlerService {
  constructor(private readonly redisService: RedisService) {}

  async isRateLimited(
    key: string,
    limit: number,
    ttl: number,
  ): Promise<boolean> {
    const client = this.redisService.getIoRedisClient();
    const current = await client.incr(key);
    
    if (current === 1) {
      await client.expire(key, ttl);
    }
    
    return current > limit;
  }

  async resetRateLimit(key: string): Promise<void> {
    const client = this.redisService.getIoRedisClient();
    await client.del(key);
  }

  async getRateLimitCount(key: string): Promise<number> {
    const client = this.redisService.getIoRedisClient();
    const count = await client.get(key);
    return count ? parseInt(count, 10) : 0;
  }
}
