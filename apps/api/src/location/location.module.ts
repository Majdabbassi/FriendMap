import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthModule } from '../auth/auth.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { SharingModule } from '../sharing/sharing.module';
import { ThrottlingModule } from '../throttling/throttling.module';
import { LocationGateway } from './location.gateway';
import { LocationController } from './location.controller';
import { LocationHistoryService } from './location-history.service';
import { LocationRepository } from './location.repository';
import { RedisAdapterService } from '../redis/redis-adapter.service';

@Module({
  imports: [
    AuthModule,
    FriendshipsModule,
    PrismaModule,
    RedisModule,
    SharingModule,
    ThrottlingModule,
    EventEmitterModule,
  ],
  controllers: [LocationController],
  providers: [LocationGateway, LocationHistoryService, LocationRepository, RedisAdapterService],
  exports: [LocationRepository],
})
export class LocationModule {}