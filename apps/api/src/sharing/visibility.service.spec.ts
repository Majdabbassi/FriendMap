import { FriendshipStatus, SharingListType, SharingMode } from '@prisma/client';
import { VisibilityService } from './visibility.service';

describe('VisibilityService', () => {
  const viewerId = 'viewer';
  const targetId = 'target';
  let prisma: {
    friendship: { findFirst: jest.Mock };
    sharingSettings: { findUnique: jest.Mock };
    sharingListEntry: { findUnique: jest.Mock };
  };
  let service: VisibilityService;

  beforeEach(() => {
    prisma = {
      friendship: { findFirst: jest.fn() },
      sharingSettings: { findUnique: jest.fn() },
      sharingListEntry: { findUnique: jest.fn() },
    };
    service = new VisibilityService(prisma as never);
    prisma.friendship.findFirst.mockResolvedValue({
      status: FriendshipStatus.ACCEPTED,
    });
    prisma.sharingListEntry.findUnique.mockResolvedValue(null);
  });

  it('rejects self-checks without querying Prisma', async () => {
    await expect(service.canView(viewerId, viewerId)).resolves.toBe(false);
    expect(prisma.friendship.findFirst).not.toHaveBeenCalled();
  });

  it('rejects non-friends', async () => {
    prisma.friendship.findFirst.mockResolvedValue(null);
    await expect(service.canView(viewerId, targetId)).resolves.toBe(false);
  });

  it.each([
    [SharingMode.GHOST, false],
    [SharingMode.EVERYONE, true],
  ])('handles %s mode', async (mode, expected) => {
    prisma.sharingSettings.findUnique.mockResolvedValue({ mode });
    await expect(service.canView(viewerId, targetId)).resolves.toBe(expected);
    expect(prisma.sharingListEntry.findUnique).not.toHaveBeenCalled();
  });

  it('defaults to GHOST when sharing settings are missing', async () => {
    prisma.sharingSettings.findUnique.mockResolvedValue(null);

    await expect(service.canView(viewerId, targetId)).resolves.toBe(false);
    expect(prisma.sharingListEntry.findUnique).not.toHaveBeenCalled();
  });

  it('allows SELECTED only when the viewer is selected', async () => {
    prisma.sharingSettings.findUnique.mockResolvedValue({
      mode: SharingMode.SELECTED,
    });
    prisma.sharingListEntry.findUnique.mockResolvedValue({
      listType: SharingListType.SELECTED,
    });
    await expect(service.canView(viewerId, targetId)).resolves.toBe(true);
    prisma.sharingListEntry.findUnique.mockResolvedValue(null);
    await expect(service.canView(viewerId, targetId)).resolves.toBe(false);
  });

  it('allows EXCEPT_SELECTED unless the viewer is excluded', async () => {
    prisma.sharingSettings.findUnique.mockResolvedValue({
      mode: SharingMode.EXCEPT_SELECTED,
    });
    await expect(service.canView(viewerId, targetId)).resolves.toBe(true);
    prisma.sharingListEntry.findUnique.mockResolvedValue({
      listType: SharingListType.EXCEPT,
    });
    await expect(service.canView(viewerId, targetId)).resolves.toBe(false);
  });
});