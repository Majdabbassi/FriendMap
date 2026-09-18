import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ThrottlingModule } from '../throttling/throttling.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { MessagesRepository } from './messages.repository';
import { MessagesService } from './messages.service';
import { PresenceService } from './presence.service';
import { UploadsController } from './uploads.controller';

@Module({
  imports: [
    AuthModule,
    FriendshipsModule,
    PrismaModule,
    RedisModule,
    ThrottlingModule,
  ],
  controllers: [MessagesController, AttachmentsController, UploadsController],
  providers: [
    MessagesService,
    MessagesGateway,
    MessagesRepository,
    PresenceService,
    AttachmentsService,
  ],
  exports: [MessagesService, PresenceService],
})
export class MessagesModule {}