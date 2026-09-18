import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisAdapterService } from './redis-adapter.service';

@Module({
  providers: [RedisService, RedisAdapterService],
  exports: [RedisService, RedisAdapterService],
})
export class RedisModule {}