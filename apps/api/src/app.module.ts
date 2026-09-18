import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { validate } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { FriendshipsModule } from './friendships/friendships.module';
import { UsersModule } from './users/users.module';
import { SharingModule } from './sharing/sharing.module';
import { LocationModule } from './location/location.module';
import { MessagesModule } from './messages/messages.module';
import { SeedModule } from './seed/seed.module';
import { ThrottlingModule } from './throttling/throttling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '../../../.env'),
      validate,
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    ThrottlingModule,
    HealthModule,
    UsersModule,
    AuthModule,
    FriendshipsModule,
    SharingModule,
    LocationModule,
    MessagesModule,
    SeedModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
  ],
})
export class AppModule {}
