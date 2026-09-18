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

/** Prisma `where` clause matching any friendship between the two users, either direction. */
export function friendshipsBetweenWhere(userAId: string, userBId: string) {
  return {
    OR: [
      { requesterId: userAId, addresseeId: userBId },
      { requesterId: userBId, addresseeId: userAId },
    ],
  };
}

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
