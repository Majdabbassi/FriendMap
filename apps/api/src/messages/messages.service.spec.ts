import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MessagesService } from './messages.service';

describe('MessagesService', () => {
  const alice = 'alice-id';
  const bob = 'bob-id';
  const carol = 'carol-id';

  const repository = {
    findMessageById: jest.fn(),
    findConversation: jest.fn(),
    save: jest.fn(),
    markAllRead: jest.fn(),
    listConversations: jest.fn(),
  };
  const friendshipsService = { areAcceptedFriends: jest.fn() };
  const presenceService = { getManyPresence: jest.fn() };
  let service: MessagesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MessagesService(
      repository as never,
      friendshipsService as never,
      presenceService as never,
    );
  });

  describe('send', () => {
    it('persists a message between friends', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(true);
      repository.save.mockResolvedValue({
        id: 'msg-1',
        senderId: alice,
        recipientId: bob,
        body: 'hello',
      });

      const result = await service.send(alice, {
        recipientId: bob,
        body: 'hello',
      });

      expect(repository.save).toHaveBeenCalledWith(
        alice,
        bob,
        'hello',
        undefined,
      );
      expect(result.id).toBe('msg-1');
    });

    it('rejects messaging yourself', async () => {
      await expect(
        service.send(alice, { recipientId: alice, body: 'me' }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects non-friends', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(false);

      await expect(
        service.send(alice, { recipientId: carol, body: 'spam' }),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects a message with neither text nor an image', async () => {
      await expect(service.send(alice, { recipientId: bob })).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('persists an image-only message', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(true);
      repository.save.mockResolvedValue({ id: 'msg-img' });

      await service.send(alice, {
        recipientId: bob,
        imageUrl: '/uploads/6b29fc40-1111-2222-3333-444455556666.png',
      });

      expect(repository.save).toHaveBeenCalledWith(
        alice,
        bob,
        null,
        '/uploads/6b29fc40-1111-2222-3333-444455556666.png',
      );
    });

    it('persists an image alongside a caption', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(true);
      repository.save.mockResolvedValue({ id: 'msg-caption' });

      await service.send(alice, {
        recipientId: bob,
        body: 'check this out',
        imageUrl: '/uploads/6b29fc40-1111-2222-3333-444455556666.jpg',
      });

      expect(repository.save).toHaveBeenCalledWith(
        alice,
        bob,
        'check this out',
        '/uploads/6b29fc40-1111-2222-3333-444455556666.jpg',
      );
    });
  });

  describe('conversation', () => {
    it('returns history in ascending order', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(true);
      repository.findConversation.mockResolvedValue([
        { id: 'm2', createdAt: new Date('2026-01-02T00:00:00Z') },
        { id: 'm1', createdAt: new Date('2026-01-01T00:00:00Z') },
      ]);

      const rows = await service.conversation(alice, bob, { limit: 50 });

      expect(repository.findConversation).toHaveBeenCalledWith(
        alice,
        bob,
        undefined,
        50,
      );
      expect(rows.map((row) => row.id)).toEqual(['m1', 'm2']);
    });

    it('resolves the before cursor to a timestamp', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(true);
      const cursorDate = new Date('2026-01-10T00:00:00Z');
      repository.findMessageById.mockResolvedValue({
        id: 'cursor-msg',
        createdAt: cursorDate,
      });
      repository.findConversation.mockResolvedValue([]);

      await service.conversation(alice, bob, { before: 'cursor-msg', limit: 20 });

      expect(repository.findMessageById).toHaveBeenCalledWith('cursor-msg');
      expect(repository.findConversation).toHaveBeenCalledWith(
        alice,
        bob,
        cursorDate,
        20,
      );
    });

    it('throws for a missing cursor message', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(true);
      repository.findMessageById.mockResolvedValue(null);

      await expect(
        service.conversation(alice, bob, { before: 'missing' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects non-friends', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(false);

      await expect(
        service.conversation(alice, carol, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('clamps the limit to the supported range', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(true);
      repository.findConversation.mockResolvedValue([]);

      await service.conversation(alice, bob, { limit: 9999 });
      expect(repository.findConversation).toHaveBeenCalledWith(
        alice,
        bob,
        undefined,
        100,
      );

      repository.findConversation.mockClear();
      await service.conversation(alice, bob, { limit: -5 });
      expect(repository.findConversation).toHaveBeenCalledWith(
        alice,
        bob,
        undefined,
        50,
      );
    });
  });

  describe('conversations', () => {
    it('annotates each conversation with friend presence', async () => {
      repository.listConversations.mockResolvedValue([
        {
          friendId: bob,
          friendUsername: 'bob',
          friendEmail: 'bob@friendmap.dev',
          lastMessage: null,
          unreadCount: 0,
        },
      ]);
      presenceService.getManyPresence.mockResolvedValue(new Map([[bob, true]]));

      const result = await service.conversations(alice);

      expect(result[0].friendOnline).toBe(true);
      expect(presenceService.getManyPresence).toHaveBeenCalledWith([bob]);
    });
  });

  describe('markConversationRead', () => {
    it('marks unread messages and returns a receipt', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(true);
      repository.markAllRead.mockResolvedValue(3);

      const receipt = await service.markConversationRead(alice, bob);

      expect(repository.markAllRead).toHaveBeenCalledWith(bob, alice);
      expect(receipt.senderId).toBe(bob);
      expect(receipt.readAt).toBeInstanceOf(Date);
    });

    it('rejects non-friends', async () => {
      friendshipsService.areAcceptedFriends.mockResolvedValue(false);

      await expect(
        service.markConversationRead(alice, carol),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});