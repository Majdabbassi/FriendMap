import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SeedOnStartupService } from './seed-on-startup.service';

@Module({
  imports: [PrismaModule],
  providers: [SeedOnStartupService],
})
export class SeedModule {}
