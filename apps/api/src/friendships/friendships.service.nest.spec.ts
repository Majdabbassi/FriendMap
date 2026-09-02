import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { FriendshipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { FriendshipsService } from './friendships.service';

describe('FriendshipsService through Nest DI', () => {
  it('rejects a duplicate accepted friendship', async () => {
    const prisma = {
      friendship: {
        findMany: jest.fn().mockResolvedValue([
          {
            requesterId: 'user-a',
            addresseeId: 'user-b',
            status: FriendshipStatus.ACCEPTED,
          },
        ]),
      },
    };
    const usersService = {
      findByEmail: jest.fn().mockResolvedValue({ id: 'user-b' }),
    };
    const eventEmitter = { emit: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        FriendshipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();
    const service = module.get(FriendshipsService);

    await expect(
      service.request('user-a', { targetEmail: 'b@example.com' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.friendship.findMany).toHaveBeenCalledTimes(1);
  });
});