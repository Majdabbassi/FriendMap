import type { Server, Socket } from 'socket.io';
import { MessagesGateway } from './messages.gateway';

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

describe('MessagesGateway', () => {
  const alice = 'alice-id';
  const bob = 'bob-id';
  const carol = 'carol-id';

  const jwtService = { verifyAsync: jest.fn() };
  const messagesService = { send: jest.fn(), markConversationRead: jest.fn() };
  const friendshipsRepository = { findAcceptedFriendIds: jest.fn() };
  const presenceService = {
    setOnline: jest.fn(),
    setOffline: jest.fn(),
    listOnlineUserIds: jest.fn(),
  };
  const redisThrottler = { isRateLimited: jest.fn().mockResolvedValue(false) };

  const serverTo = jest.fn().mockReturnValue({ emit: jest.fn() });
  const serverIn = jest.fn().mockReturnValue({ fetchSockets: jest.fn() });
  const server = { to: serverTo, in: serverIn } as unknown as Server;

  let gateway: MessagesGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    redisThrottler.isRateLimited.mockResolvedValue(false);
    serverTo.mockReturnValue({ emit: jest.fn() });
    gateway = new MessagesGateway(
      jwtService as never,
      messagesService as never,
      friendshipsRepository as never,
      presenceService as never,
      redisThrottler as never,
    );
    (gateway as unknown as { server: Server }).server = server;
  });

  describe('handleConnection', () => {
    it('accepts a valid token, joins the user room, and broadcasts presence', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: alice });
      friendshipsRepository.findAcceptedFriendIds.mockResolvedValue([bob, carol]);
      const socket = createSocket({ handshake: { auth: { token: 'jwt' } } });

      await gateway.handleConnection(socket);

      expect(socket.data.userId).toBe(alice);
      expect(socket.join).toHaveBeenCalledWith('user:alice-id');
      expect(presenceService.setOnline).toHaveBeenCalledWith(alice);
      expect(serverTo).toHaveBeenCalledWith('user:bob-id');
      expect(serverTo).toHaveBeenCalledWith('user:carol-id');
    });

    it('disconnects sockets with missing or invalid tokens', async () => {
      const missingToken = createSocket({ handshake: { auth: {} } });
      await gateway.handleConnection(missingToken);
      expect(missingToken.disconnect).toHaveBeenCalledWith(true);

      const badToken = createSocket({ handshake: { auth: { token: 'bad' } } });
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      await gateway.handleConnection(badToken);
      expect(badToken.disconnect).toHaveBeenCalledWith(true);
      expect(presenceService.setOnline).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('keeps presence online while other sockets remain', async () => {
      serverIn.mockReturnValue({
        fetchSockets: jest.fn().mockResolvedValue([{}, {}]),
      });
      const socket = createSocket();
      socket.data.userId = alice;

      await gateway.handleDisconnect(socket);

      expect(presenceService.setOffline).not.toHaveBeenCalled();
    });

    it('marks offline and notifies friends when the last socket leaves', async () => {
      serverIn.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) });
      friendshipsRepository.findAcceptedFriendIds.mockResolvedValue([bob]);
      const socket = createSocket();
      socket.data.userId = alice;

      await gateway.handleDisconnect(socket);

      expect(presenceService.setOffline).toHaveBeenCalledWith(alice);
      expect(serverTo).toHaveBeenCalledWith('user:bob-id');
    });
  });

  describe('sendMessage', () => {
    it('delivers the message to the sender and the recipient room', async () => {
      const message = {
        id: 'm1',
        senderId: alice,
        recipientId: bob,
        body: 'hey',
        createdAt: new Date(),
        readAt: null,
      };
      messagesService.send.mockResolvedValue(message);
      const socket = createSocket();
      socket.data.userId = alice;

      await gateway.sendMessage(socket, { recipientId: bob, body: 'hey' });

      expect(messagesService.send).toHaveBeenCalledWith(alice, {
        recipientId: bob,
        body: 'hey',
      });
      expect(socket.emit).toHaveBeenCalledWith('message:sent', message);
      expect(serverTo).toHaveBeenCalledWith('user:bob-id');
      const { emit } = serverTo.mock.results[0].value;
      expect(emit).toHaveBeenCalledWith('message:new', message);
    });

    it('rejects updates that hit the send rate limit', async () => {
      redisThrottler.isRateLimited.mockResolvedValue(true);
      const socket = createSocket();
      socket.data.userId = alice;

      await gateway.sendMessage(socket, { recipientId: bob, body: 'spam' });

      expect(messagesService.send).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('message:error', {
        message: 'rate-limited',
      });
    });

    it('reports authorization failures to the sender', async () => {
      messagesService.send.mockRejectedValue(new Error('forbidden'));
      const socket = createSocket();
      socket.data.userId = alice;

      await gateway.sendMessage(socket, { recipientId: carol, body: 'spam' });

      expect(socket.emit).toHaveBeenCalledWith('message:error', {
        message: 'forbidden',
      });
    });
  });

  describe('markRead', () => {
    it('notifies the original sender when their messages are read', async () => {
      const readAt = new Date();
      messagesService.markConversationRead.mockResolvedValue({
        senderId: bob,
        readAt,
      });
      const socket = createSocket();
      socket.data.userId = alice;

      await gateway.markRead(socket, { senderId: bob });

      expect(messagesService.markConversationRead).toHaveBeenCalledWith(
        alice,
        bob,
      );
      expect(serverTo).toHaveBeenCalledWith('user:bob-id');
      const { emit } = serverTo.mock.results[0].value;
      expect(emit).toHaveBeenCalledWith('message:read', {
        senderId: alice,
        readAt,
      });
    });

    it('silently ignores unauthorized read attempts', async () => {
      messagesService.markConversationRead.mockRejectedValueOnce(
        new Error('forbidden'),
      );
      const socket = createSocket();
      socket.data.userId = alice;

      await expect(
        gateway.markRead(socket, { senderId: carol }),
      ).resolves.toBeUndefined();
      expect(serverTo).not.toHaveBeenCalled();
    });
  });

  describe('presenceSnapshot', () => {
    it('returns the online friend ids', async () => {
      friendshipsRepository.findAcceptedFriendIds.mockResolvedValue([bob, carol]);
      presenceService.listOnlineUserIds.mockResolvedValue([bob]);
      const socket = createSocket();
      socket.data.userId = alice;

      await gateway.presenceSnapshot(socket);

      expect(socket.emit).toHaveBeenCalledWith('presence:snapshot', {
        onlineUserIds: [bob],
      });
    });
  });
});