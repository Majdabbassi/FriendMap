import { Injectable } from '@nestjs/common';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisService } from './redis.service';

@Injectable()
export class RedisAdapterService {
  constructor(private readonly redisService: RedisService) {}

  createSocketIOAdapter(server: SocketIOServer) {
    const pubClient = this.redisService.getIoRedisClient();
    const subClient = pubClient.duplicate();
    
    const adapter = createAdapter(pubClient, subClient, {
      key: 'friendmap:socket.io',
    });
    
    server.adapter(adapter);
    
    return adapter;
  }
}
