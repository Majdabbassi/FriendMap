import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SharingController } from './sharing.controller';
import { SharingService } from './sharing.service';
import { VisibilityService } from './visibility.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SharingController],
  providers: [SharingService, VisibilityService],
  exports: [SharingService, VisibilityService],
})
export class SharingModule {}