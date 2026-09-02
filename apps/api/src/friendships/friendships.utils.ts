import { FriendshipStatus } from '@prisma/client';

export const BLOCKING_FRIENDSHIP_STATUSES: FriendshipStatus[] = [
  FriendshipStatus.PENDING,
  FriendshipStatus.ACCEPTED,
];

type FriendshipPair = {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
};

export function isSameUserPair(
  friendship: Pick<FriendshipPair, 'requesterId' | 'addresseeId'>,
  userA: string,
  userB: string,
): boolean {
  return (
    (friendship.requesterId === userA && friendship.addresseeId === userB) ||
    (friendship.requesterId === userB && friendship.addresseeId === userA)
  );
}

export function isBlockingFriendshipStatus(status: FriendshipStatus): boolean {
  return BLOCKING_FRIENDSHIP_STATUSES.includes(status);
}

/** True when a PENDING or ACCEPTED friendship already exists between the two users, either direction. */
export function hasBlockingFriendship(
  existing: FriendshipPair[],
  userA: string,
  userB: string,
): boolean {
  return existing.some(
    (friendship) =>
      isSameUserPair(friendship, userA, userB) &&
      isBlockingFriendshipStatus(friendship.status),
  );
}

export function friendshipsBetweenWhere(userA: string, userB: string) {
  return {
    OR: [
      { requesterId: userA, addresseeId: userB },
      { requesterId: userB, addresseeId: userA },
    ],
  };
}

type PrismaFriendshipFindMany = {
  friendship: {
    findMany: (args: {
      where: ReturnType<typeof friendshipsBetweenWhere>;
    }) => Promise<FriendshipPair[]>;
  };
};

export function loadFriendshipsBetween(
  prisma: PrismaFriendshipFindMany,
  userA: string,
  userB: string,
) {
  return prisma.friendship.findMany({
    where: friendshipsBetweenWhere(userA, userB),
  });
}

export async function isDuplicateFriendRequest(
  prisma: PrismaFriendshipFindMany,
  userA: string,
  userB: string,
) {
  const existing = await loadFriendshipsBetween(prisma, userA, userB);
  return hasBlockingFriendship(existing, userA, userB);
}
