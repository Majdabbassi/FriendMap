import { FriendshipStatus } from '@prisma/client';
import {
  friendshipsBetweenWhere,
  isDuplicateFriendRequest,
} from './friendships.utils';

describe('isDuplicateFriendRequest (mocked Prisma)', () => {
  const userA = 'user-a';
  const userB = 'user-b';

  let prisma: {
    friendship: {
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      friendship: {
        findMany: jest.fn(),
      },
    };
  });

  it('queries both directions and does not hit a database', async () => {
    prisma.friendship.findMany.mockResolvedValue([]);

    await isDuplicateFriendRequest(prisma, userA, userB);

    expect(prisma.friendship.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.friendship.findMany).toHaveBeenCalledWith({
      where: friendshipsBetweenWhere(userA, userB),
    });
  });

  it('is a duplicate when Prisma returns a PENDING row in either direction', async () => {
    prisma.friendship.findMany.mockResolvedValue([
      {
        requesterId: userB,
        addresseeId: userA,
        status: FriendshipStatus.PENDING,
      },
    ]);

    await expect(isDuplicateFriendRequest(prisma, userA, userB)).resolves.toBe(
      true,
    );
  });

  it('is a duplicate when Prisma returns an ACCEPTED row in either direction', async () => {
    prisma.friendship.findMany.mockResolvedValue([
      {
        requesterId: userA,
        addresseeId: userB,
        status: FriendshipStatus.ACCEPTED,
      },
    ]);

    await expect(isDuplicateFriendRequest(prisma, userA, userB)).resolves.toBe(
      true,
    );
  });

  it('is not a duplicate when Prisma returns only REJECTED', async () => {
    prisma.friendship.findMany.mockResolvedValue([
      {
        requesterId: userA,
        addresseeId: userB,
        status: FriendshipStatus.REJECTED,
      },
    ]);

    await expect(isDuplicateFriendRequest(prisma, userA, userB)).resolves.toBe(
      false,
    );
  });

  it('is not a duplicate when Prisma returns no rows', async () => {
    prisma.friendship.findMany.mockResolvedValue([]);

    await expect(isDuplicateFriendRequest(prisma, userA, userB)).resolves.toBe(
      false,
    );
  });
});
