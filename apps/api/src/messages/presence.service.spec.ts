import { RedisService } from '../redis/redis.service';
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  const userId = 'user-1';

  const redis = {
    getIoRedisClient: jest.fn().mockReturnValue({
      get: jest.fn(),
      set: jest.fn(),
      mget: jest.fn(),
    }),
  };
  let service: PresenceService;
  let client: { get: jest.Mock; set: jest.Mock; mget: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PresenceService(redis as unknown as RedisService);
    client = redis.getIoRedisClient();
  });

  it('marks a user online with a TTL', async () => {
    await service.setOnline(userId);

    expect(client.set).toHaveBeenCalledWith(
      `presence:${userId}`,
      expect.stringContaining('"online":true'),
      'EX',
      90,
    );
  });

  it('marks a user offline with a TTL', async () => {
    await service.setOffline(userId);

    expect(client.set).toHaveBeenCalledWith(
      `presence:${userId}`,
      expect.stringContaining('"online":false'),
      'EX',
      90,
    );
  });

  it('reports offline when there is no record', async () => {
    client.get.mockResolvedValue(null);

    await expect(service.isOnline(userId)).resolves.toBe(false);
  });

  it('reads presence back from redis', async () => {
    client.get.mockResolvedValue(
      JSON.stringify({ online: true, lastSeen: 123456 }),
    );

    await expect(service.isOnline(userId)).resolves.toBe(true);
    const presence = await service.getPresence(userId);
    expect(presence?.lastSeen).toBe(123456);
  });

  it('bulk-reads presence for many users', async () => {
    client.mget.mockResolvedValue([
      JSON.stringify({ online: true, lastSeen: 1 }),
      null,
    ]);

    const map = await service.getManyPresence(['a', 'b']);

    expect(client.mget).toHaveBeenCalledWith(['presence:a', 'presence:b']);
    expect(map.get('a')).toBe(true);
    expect(map.get('b')).toBe(false);
  });

  it('filters online users from a list', async () => {
    client.mget.mockResolvedValue([
      JSON.stringify({ online: true, lastSeen: 1 }),
      JSON.stringify({ online: false, lastSeen: 2 }),
    ]);

    const online = await service.listOnlineUserIds(['a', 'b']);

    expect(online).toEqual(['a']);
  });
});