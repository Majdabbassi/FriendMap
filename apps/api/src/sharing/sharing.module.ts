import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { SharingController } from './sharing.controller';
import { SharingService } from './sharing.service';
import { VisibilityService } from './visibility.service';
import { SharingRepository } from './sharing.repository';

@Module({
  imports: [PrismaModule, AuthModule, FriendshipsModule],
  controllers: [SharingController],
  providers: [SharingService, VisibilityService, SharingRepository],
  exports: [SharingService, VisibilityService, SharingRepository],
})
export class SharingModule {}