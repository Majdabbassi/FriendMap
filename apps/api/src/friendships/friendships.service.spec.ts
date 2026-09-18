import { ConflictException, NotFoundException } from '@nestjs/common';
import { FriendshipStatus } from '@prisma/client';
import { FriendshipsService } from './friendships.service';

describe('FriendshipsService', () => {
  const userA = 'user-a';
  const userB = 'user-b';

  const repository = {
    findBetweenUsers: jest.fn(),
    create: jest.fn(),
  };
  const usersService = {
    findByEmail: jest.fn(),
    findByUsername: jest.fn(),
  };
  const eventEmitter = { emit: jest.fn() };
  let service: FriendshipsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FriendshipsService(
      repository as never,
      usersService as never,
      eventEmitter as never,
    );
  });

  it('queries both directions through the repository', async () => {
    usersService.findByEmail.mockResolvedValue({ id: userB });
    repository.findBetweenUsers.mockResolvedValue([]);
    repository.create.mockResolvedValue({ id: 'friendship-id' });

    await service.request(userA, { targetEmail: 'b@example.com' });

    expect(repository.findBetweenUsers).toHaveBeenCalledWith(userA, userB);
    expect(repository.create).toHaveBeenCalledWith(userA, userB);
  });

  it('throws when an ACCEPTED friendship already exists', async () => {
    usersService.findByEmail.mockResolvedValue({ id: userB });
    repository.findBetweenUsers.mockResolvedValue([
      { requesterId: userA, addresseeId: userB, status: FriendshipStatus.ACCEPTED },
    ]);

    await expect(
      service.request(userA, { targetEmail: 'b@example.com' }),
    ).rejects.toThrow(new ConflictException('You are already friends with this user'));
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('throws a distinct message for an already PENDING request', async () => {
    usersService.findByEmail.mockResolvedValue({ id: userB });
    repository.findBetweenUsers.mockResolvedValue([
      { requesterId: userB, addresseeId: userA, status: FriendshipStatus.PENDING },
    ]);

    await expect(
      service.request(userA, { targetEmail: 'b@example.com' }),
    ).rejects.toThrow(new ConflictException('Friend request already pending'));
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('throws when the target user does not exist', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.request(userA, { targetEmail: 'missing@example.com' }),
    ).rejects.toThrow(NotFoundException);
  });
});