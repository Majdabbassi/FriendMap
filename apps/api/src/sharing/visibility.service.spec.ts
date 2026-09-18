import { FriendshipStatus, SharingListType, SharingMode } from '@prisma/client';
import { VisibilityService } from './visibility.service';

describe('VisibilityService', () => {
  const viewerId = 'viewer';
  const targetId = 'target';

  const friendshipsRepository = {
    findBetweenUsers: jest.fn(),
  };
  const sharingRepository = {
    getModeOrDefault: jest.fn(),
    findListEntry: jest.fn(),
  };
  let service: VisibilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VisibilityService(
      friendshipsRepository as never,
      sharingRepository as never,
    );
    friendshipsRepository.findBetweenUsers.mockResolvedValue([
      { status: FriendshipStatus.ACCEPTED },
    ]);
    sharingRepository.findListEntry.mockResolvedValue(null);
    sharingRepository.getModeOrDefault.mockResolvedValue(SharingMode.GHOST);
  });

  it('rejects self-checks without querying repositories', async () => {
    await expect(service.canView(viewerId, viewerId)).resolves.toBe(false);
    expect(friendshipsRepository.findBetweenUsers).not.toHaveBeenCalled();
    expect(sharingRepository.getModeOrDefault).not.toHaveBeenCalled();
  });

  it('rejects non-friends', async () => {
    friendshipsRepository.findBetweenUsers.mockResolvedValue([]);
    await expect(service.canView(viewerId, targetId)).resolves.toBe(false);
    expect(sharingRepository.getModeOrDefault).not.toHaveBeenCalled();
  });

  it.each([
    [SharingMode.GHOST, false],
    [SharingMode.EVERYONE, true],
  ])('handles %s mode', async (mode, expected) => {
    sharingRepository.getModeOrDefault.mockResolvedValue(mode);
    await expect(service.canView(viewerId, targetId)).resolves.toBe(expected);
    expect(sharingRepository.findListEntry).not.toHaveBeenCalled();
  });

  it('defaults to GHOST when sharing settings are missing', async () => {
    sharingRepository.getModeOrDefault.mockResolvedValue(SharingMode.GHOST);

    await expect(service.canView(viewerId, targetId)).resolves.toBe(false);
    expect(sharingRepository.findListEntry).not.toHaveBeenCalled();
  });

  it('allows SELECTED only when the viewer is selected', async () => {
    sharingRepository.getModeOrDefault.mockResolvedValue(SharingMode.SELECTED);
    sharingRepository.findListEntry.mockResolvedValue({
      listType: SharingListType.SELECTED,
    });
    await expect(service.canView(viewerId, targetId)).resolves.toBe(true);
    expect(sharingRepository.findListEntry).toHaveBeenCalledWith(
      targetId,
      viewerId,
      SharingListType.SELECTED,
    );

    sharingRepository.findListEntry.mockResolvedValue(null);
    await expect(service.canView(viewerId, targetId)).resolves.toBe(false);
  });

  it('allows EXCEPT_SELECTED unless the viewer is excluded', async () => {
    sharingRepository.getModeOrDefault.mockResolvedValue(SharingMode.EXCEPT_SELECTED);
    await expect(service.canView(viewerId, targetId)).resolves.toBe(true);
    expect(sharingRepository.findListEntry).toHaveBeenCalledWith(
      targetId,
      viewerId,
      SharingListType.EXCEPT,
    );

    sharingRepository.findListEntry.mockResolvedValue({
      listType: SharingListType.EXCEPT,
    });
    await expect(service.canView(viewerId, targetId)).resolves.toBe(false);
  });
});