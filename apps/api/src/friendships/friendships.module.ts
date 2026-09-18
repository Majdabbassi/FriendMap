import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { FriendshipsController } from './friendships.controller';
import { FriendshipsService } from './friendships.service';
import { FriendshipsRepository } from './friendships.repository';

@Module({
  imports: [PrismaModule, UsersModule, AuthModule],
  controllers: [FriendshipsController],
  providers: [FriendshipsService, FriendshipsRepository],
  exports: [FriendshipsService, FriendshipsRepository],
})
export class FriendshipsModule {}
