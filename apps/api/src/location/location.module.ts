import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthModule } from '../auth/auth.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { SharingModule } from '../sharing/sharing.module';
import { LocationGateway } from './location.gateway';
import { LocationController } from './location.controller';
import { LocationHistoryService } from './location-history.service';

@Module({
  imports: [
    AuthModule,
    FriendshipsModule,
    PrismaModule,
    RedisModule,
    SharingModule,
    EventEmitterModule,
  ],
  controllers: [LocationController],
  providers: [LocationGateway, LocationHistoryService],
})
export class LocationModule {}