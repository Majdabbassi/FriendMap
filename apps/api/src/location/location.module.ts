import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthModule } from '../auth/auth.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { SharingModule } from '../sharing/sharing.module';
import { LocationGateway } from './location.gateway';

@Module({
  imports: [
    AuthModule,
    FriendshipsModule,
    PrismaModule,
    RedisModule,
    SharingModule,
    EventEmitterModule,
  ],
  providers: [LocationGateway],
})
export class LocationModule {}