import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ThrottlingModule } from '../throttling/throttling.module';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { MessagesRepository } from './messages.repository';
import { MessagesService } from './messages.service';
import { PresenceService } from './presence.service';

@Module({
  imports: [
    AuthModule,
    FriendshipsModule,
    PrismaModule,
    RedisModule,
    ThrottlingModule,
  ],
  controllers: [MessagesController],
  providers: [
    MessagesService,
    MessagesGateway,
    MessagesRepository,
    PresenceService,
  ],
  exports: [MessagesService, PresenceService],
})
export class MessagesModule {}