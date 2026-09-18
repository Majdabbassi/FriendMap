import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { MessagesModule } from '../messages/messages.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ThrottlingModule } from '../throttling/throttling.module';
import { TripsController } from './trips.controller';
import { TripsGateway } from './trips.gateway';
import { TripsRepository } from './trips.repository';
import { TripsService } from './trips.service';

@Module({
  imports: [
    AuthModule,
    FriendshipsModule,
    MessagesModule,
    PrismaModule,
    RedisModule,
    ThrottlingModule,
  ],
  controllers: [TripsController],
  providers: [TripsService, TripsGateway, TripsRepository],
  exports: [TripsService, TripsRepository],
})
export class TripsModule {}