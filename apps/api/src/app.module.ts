import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { FriendshipsModule } from './friendships/friendships.module';
import { UsersModule } from './users/users.module';
import { SharingModule } from './sharing/sharing.module';
import { LocationModule } from './location/location.module';
import { HttpThrottlerGuard } from './throttling/http-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: resolve(__dirname, '../../../.env') }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    UsersModule,
    AuthModule,
    FriendshipsModule,
    SharingModule,
    LocationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: HttpThrottlerGuard,
    },
  ],
})
export class AppModule {}
