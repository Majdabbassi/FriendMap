import { FriendshipStatus } from '@prisma/client';
import {
  friendshipsBetweenWhere,
  hasBlockingFriendship,
  isBlockingFriendshipStatus,
} from './friendships.utils';

describe('hasBlockingFriendship', () => {
  const userA = 'user-a';
  const userB = 'user-b';
  const userC = 'user-c';

  it('returns false when there are no friendships', () => {
    expect(hasBlockingFriendship([], userA, userB)).toBe(false);
  });

  it('returns true for a PENDING request from A to B', () => {
    expect(
      hasBlockingFriendship(
        [
          {
            requesterId: userA,
            addresseeId: userB,
            status: FriendshipStatus.PENDING,
          },
        ],
        userA,
        userB,
      ),
    ).toBe(true);
  });

  it('returns true for a PENDING request from B to A (either direction)', () => {
    expect(
      hasBlockingFriendship(
        [
          {
            requesterId: userB,
            addresseeId: userA,
            status: FriendshipStatus.PENDING,
          },
        ],
        userA,
        userB,
      ),
    ).toBe(true);
  });

  it('returns true for an ACCEPTED friendship in either direction', () => {
    expect(
      hasBlockingFriendship(
        [
          {
            requesterId: userA,
            addresseeId: userB,
            status: FriendshipStatus.ACCEPTED,
          },
        ],
        userB,
        userA,
      ),
    ).toBe(true);
  });

  it('returns false for a REJECTED friendship (re-request is allowed)', () => {
    expect(
      hasBlockingFriendship(
        [
          {
            requesterId: userA,
            addresseeId: userB,
            status: FriendshipStatus.REJECTED,
          },
        ],
        userA,
        userB,
      ),
    ).toBe(false);
  });

  it('ignores friendships with a different user', () => {
    expect(
      hasBlockingFriendship(
        [
          {
            requesterId: userA,
            addresseeId: userC,
            status: FriendshipStatus.ACCEPTED,
          },
        ],
        userA,
        userB,
      ),
    ).toBe(false);
  });
});

describe('isBlockingFriendshipStatus', () => {
  it('treats PENDING and ACCEPTED as blocking', () => {
    expect(isBlockingFriendshipStatus(FriendshipStatus.PENDING)).toBe(true);
    expect(isBlockingFriendshipStatus(FriendshipStatus.ACCEPTED)).toBe(true);
  });

  it('does not treat REJECTED as blocking', () => {
    expect(isBlockingFriendshipStatus(FriendshipStatus.REJECTED)).toBe(false);
  });
});

describe('friendshipsBetweenWhere', () => {
  it('queries both directions', () => {
    expect(friendshipsBetweenWhere('a', 'b')).toEqual({
      OR: [
        { requesterId: 'a', addresseeId: 'b' },
        { requesterId: 'b', addresseeId: 'a' },
      ],
    });
  });
});
