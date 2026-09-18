import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RedisModule } from '../redis/redis.module';
import { RedisThrottlerService } from './redis-throttler.service';
import { HttpThrottlerGuard } from './http-throttler.guard';

@Module({
  imports: [RedisModule],
  providers: [
    RedisThrottlerService, 
    HttpThrottlerGuard,
    {
      provide: APP_GUARD,
      useClass: HttpThrottlerGuard,
    },
  ],
  exports: [RedisThrottlerService],
})
export class ThrottlingModule {}
