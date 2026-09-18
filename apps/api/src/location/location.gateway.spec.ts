import type { Server, Socket } from 'socket.io';
import { LocationGateway } from './location.gateway';
import { UpdateLocationDto } from './dto/update-location.dto';

function createSocket(overrides: Partial<Record<string, unknown>> = {}) {
  const rooms = new Set<string>();
  return {
    data: {},
    handshake: { auth: {} },
    rooms,
    emit: jest.fn(),
    join: jest.fn(async (room: string) => {
      rooms.add(room);
    }),
    leave: jest.fn(async (room: string) => {
      rooms.delete(room);
    }),
    disconnect: jest.fn(),
    ...overrides,
  } as unknown as Socket;
}

describe('LocationGateway', () => {
  const jwtService = { verifyAsync: jest.fn() };
  const redis = {
    getCurrentLocation: jest.fn(),
    setCurrentLocation: jest.fn(),
    getHistoryCheckpoint: jest.fn(),
    setHistoryCheckpoint: jest.fn(),
  };
  const redisAdapterService = { createSocketIOAdapter: jest.fn() };
  const redisThrottler = { isRateLimited: jest.fn().mockResolvedValue(false) };
  const visibility = { canViewMany: jest.fn(), canView: jest.fn() };
  const friendshipsRepository = { findAcceptedFriendIds: jest.fn() };
  const history = { enqueueIfSampled: jest.fn() };

  let gateway: LocationGateway;
  const serverIn = jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) });
  const server = { in: serverIn } as unknown as Server;

  beforeEach(() => {
    jest.clearAllMocks();
    redisThrottler.isRateLimited.mockResolvedValue(false);
    gateway = new LocationGateway(
      jwtService as never,
      redis as never,
      redisAdapterService as never,
      redisThrottler as never,
      visibility as never,
      friendshipsRepository as never,
      history as never,
    );
    (gateway as unknown as { server: Server }).server = server;
  });

  describe('handleConnection', () => {
    it('disconnects when no token is provided', async () => {
      const socket = createSocket();
      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('joins the user room when the token is valid', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      const socket = createSocket();
      socket.handshake.auth = { token: 'valid-token' };

      await gateway.handleConnection(socket);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects when the token is invalid', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));
      const socket = createSocket();
      socket.handshake.auth = { token: 'expired-token' };

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });
  });

  describe('updateLocation', () => {
    function point(): UpdateLocationDto {
      return { lat: 36.8, lng: 10.2, accuracy: 5, timestamp: Date.now() } as UpdateLocationDto;
    }

    it('rejects the update when the user is rate limited', async () => {
      redisThrottler.isRateLimited.mockResolvedValue(true);
      const socket = createSocket();
      socket.data.userId = 'user-1';

      await gateway.updateLocation(socket, point());

      expect(socket.emit).toHaveBeenCalledWith('location:rejected', { reason: 'rate-limited' });
      expect(redis.setCurrentLocation).not.toHaveBeenCalled();
    });

    it('rejects invalid points before storing them', async () => {
      redis.getCurrentLocation.mockResolvedValue(null);
      const socket = createSocket();
      socket.data.userId = 'user-1';

      await gateway.updateLocation(socket, {
        lat: 0,
        lng: 0,
        accuracy: 5,
        timestamp: Date.now() + 60_000,
      } as UpdateLocationDto);

      expect(socket.emit).toHaveBeenCalledWith('location:rejected', { reason: 'future-timestamp' });
      expect(redis.setCurrentLocation).not.toHaveBeenCalled();
    });

    it('stores the point, samples history and broadcasts to viewers', async () => {
      const payload = point();
      const viewer = createSocket();
      viewer.data.userId = 'viewer-1';

      serverIn.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([viewer]) });
      redis.getCurrentLocation.mockResolvedValue(null);
      redis.setCurrentLocation.mockResolvedValue(undefined);
      history.enqueueIfSampled.mockResolvedValue(undefined);

      const socket = createSocket();
      socket.data.userId = 'user-1';

      await gateway.updateLocation(socket, payload);

      expect(redis.setCurrentLocation).toHaveBeenCalledWith('user-1', payload);
      expect(history.enqueueIfSampled).toHaveBeenCalledWith('user-1', payload);
      expect(viewer.emit).toHaveBeenCalledWith('location:update', {
        userId: 'user-1',
        lat: payload.lat,
        lng: payload.lng,
        accuracy: payload.accuracy,
        updatedAt: payload.timestamp,
      });
    });

    it('does not broadcast to viewers who stopped viewing', async () => {
      const stoppedViewer = createSocket();
      stoppedViewer.data.userId = 'viewer-1';
      stoppedViewer.data.stoppedViewingFriendIds = new Set(['user-1']);

      serverIn.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([stoppedViewer]) });
      redis.getCurrentLocation.mockResolvedValue(null);

      const socket = createSocket();
      socket.data.userId = 'user-1';

      await gateway.updateLocation(socket, point());

      expect(stoppedViewer.emit).not.toHaveBeenCalled();
    });
  });

  describe('viewFriends', () => {
    it('joins rooms and emits a snapshot for authorized friends', async () => {
      const socket = createSocket();
      socket.data.userId = 'viewer-1';

      friendshipsRepository.findAcceptedFriendIds.mockResolvedValue(['friend-1', 'friend-2']);
      visibility.canViewMany.mockResolvedValue(
        new Map([
          ['friend-1', true],
          ['friend-2', false],
        ]),
      );
      redis.getCurrentLocation.mockImplementation(async (friendId: string) =>
        friendId === 'friend-1'
          ? { lat: 1, lng: 2, accuracy: 3, timestamp: 4 }
          : null,
      );

      await gateway.viewFriends(socket);

      expect(socket.join).toHaveBeenCalledWith('location:friend-1');
      expect(socket.join).not.toHaveBeenCalledWith('location:friend-2');
      expect(socket.emit).toHaveBeenCalledWith('location:snapshot', [
        { userId: 'friend-1', lat: 1, lng: 2, accuracy: 3, updatedAt: 4 },
      ]);
    });

    it('skips friends the viewer stopped viewing', async () => {
      const socket = createSocket();
      socket.data.userId = 'viewer-1';
      socket.data.stoppedViewingFriendIds = new Set(['friend-1']);

      friendshipsRepository.findAcceptedFriendIds.mockResolvedValue(['friend-1']);
      visibility.canViewMany.mockResolvedValue(new Map([['friend-1', true]]));

      await gateway.viewFriends(socket);

      expect(socket.join).not.toHaveBeenCalledWith('location:friend-1');
      expect(socket.emit).toHaveBeenCalledWith('location:snapshot', []);
    });
  });

  describe('stopViewing / resumeViewing', () => {
    it('marks the friend as stopped and leaves their room', async () => {
      const socket = createSocket();
      socket.data.userId = 'viewer-1';

      await gateway.stopViewing(socket, { friendId: 'friend-1' } as never);

      expect(
        (socket.data.stoppedViewingFriendIds as Set<string>).has('friend-1'),
      ).toBe(true);
      expect(socket.leave).toHaveBeenCalledWith('location:friend-1');
    });

    it('resumes viewing when authorization passes and emits the current location', async () => {
      const socket = createSocket();
      socket.data.userId = 'viewer-1';
      socket.data.stoppedViewingFriendIds = new Set(['friend-1']);

      visibility.canView.mockResolvedValue(true);
      redis.getCurrentLocation.mockResolvedValue({ lat: 1, lng: 2, accuracy: 3, timestamp: 4 });

      await gateway.resumeViewing(socket, { friendId: 'friend-1' } as never);

      expect(
        (socket.data.stoppedViewingFriendIds as Set<string>).has('friend-1'),
      ).toBe(false);
      expect(socket.join).toHaveBeenCalledWith('location:friend-1');
      expect(socket.emit).toHaveBeenCalledWith('location:snapshot', [
        { userId: 'friend-1', lat: 1, lng: 2, accuracy: 3, updatedAt: 4 },
      ]);
    });

    it('emits hidden when the viewer is no longer authorized', async () => {
      const socket = createSocket();
      socket.data.userId = 'viewer-1';

      visibility.canView.mockResolvedValue(false);

      await gateway.resumeViewing(socket, { friendId: 'friend-1' } as never);

      expect(socket.emit).toHaveBeenCalledWith('location:hidden', { userId: 'friend-1' });
      expect(socket.join).not.toHaveBeenCalledWith('location:friend-1');
    });
  });

  describe('privacy event handlers', () => {
    it('revokes unauthorized viewers and grants newly authorized ones on mode change', async () => {
      const targetSocket = createSocket();
      targetSocket.data.userId = 'viewer-1';
      const friendSocket = createSocket();
      friendSocket.data.userId = 'friend-1';

      serverIn.mockImplementation((room: string) => ({
        fetchSockets: jest.fn().mockImplementation(async () => {
          if (room === 'location:owner-1') return [targetSocket];
          if (room === 'user:friend-1') return [friendSocket];
          return [];
        }),
      }));

      visibility.canView.mockResolvedValue(false);
      friendshipsRepository.findAcceptedFriendIds.mockResolvedValue(['friend-1']);
      visibility.canViewMany.mockResolvedValue(new Map([['friend-1', true]]));
      redis.getCurrentLocation.mockResolvedValue({ lat: 1, lng: 2, accuracy: 3, timestamp: 4 });

      await gateway.onSharingModeChanged({ userId: 'owner-1' });

      expect(targetSocket.leave).toHaveBeenCalledWith('location:owner-1');
      expect(targetSocket.emit).toHaveBeenCalledWith('location:hidden', { userId: 'owner-1' });
      expect(friendSocket.join).toHaveBeenCalledWith('location:owner-1');
      expect(friendSocket.emit).toHaveBeenCalledWith('location:update', {
        userId: 'owner-1',
        lat: 1,
        lng: 2,
        accuracy: 3,
        updatedAt: 4,
      });
    });

    it('revokes both sides when a friendship is removed', async () => {
      const socketA = createSocket();
      socketA.data.userId = 'viewer-of-a';

      serverIn.mockImplementation((room: string) => ({
        fetchSockets: jest.fn().mockImplementation(async () => {
          if (room === 'location:user-a') return [socketA];
          return [];
        }),
      }));
      visibility.canView.mockResolvedValue(false);
      friendshipsRepository.findAcceptedFriendIds.mockResolvedValue([]);
      redis.getCurrentLocation.mockResolvedValue(null);

      await gateway.onFriendshipRemoved({ userAId: 'user-a', userBId: 'user-b' });

      expect(visibility.canView).toHaveBeenCalled();
      expect(socketA.leave).toHaveBeenCalledWith('location:user-a');
      expect(socketA.emit).toHaveBeenCalledWith('location:hidden', { userId: 'user-a' });
    });
  });
});
