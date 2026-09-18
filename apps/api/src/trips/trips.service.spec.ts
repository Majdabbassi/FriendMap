import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TripMemberRole, TripStatus } from '@prisma/client';
import { TripsService } from './trips.service';

describe('TripsService', () => {
  const alice = 'alice-id';
  const bob = 'bob-id';
  const carol = 'carol-id';
  const tripId = 'trip-1';

  const repository = {
    createTrip: jest.fn(),
    findTripById: jest.fn(),
    updateTrip: jest.fn(),
    deleteTrip: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
    findMembers: jest.fn(),
    findMember: jest.fn(),
    memberIds: jest.fn(),
    listTripsForUser: jest.fn(),
    findPendingInvitesForTrip: jest.fn(),
    listPendingInvitesFor: jest.fn(),
    findInviteById: jest.fn(),
    createInvite: jest.fn(),
    updateInviteStatus: jest.fn(),
    findMessages: jest.fn(),
    saveTripMessage: jest.fn(),
    setArrived: jest.fn(),
  };
  const friendshipsService = { areAcceptedFriends: jest.fn() };
  let service: TripsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TripsService(
      repository as never,
      friendshipsService as never,
    );
  });

  function mockMember(userId: string, role = TripMemberRole.MEMBER, arrivedAt = null) {
    return { id: `m-${userId}`, tripId, userId, role, joinedAt: new Date(), arrivedAt };
  }

  describe('create', () => {
    it('creates a trip, adds the creator as admin, and invites only friends', async () => {
      repository.createTrip.mockResolvedValue({ id: tripId, name: 'Hike' });
      repository.findMember.mockResolvedValue(null);
      friendshipsService.areAcceptedFriends
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      repository.createInvite.mockResolvedValue({ id: 'inv-1' });

      const result = await service.create(alice, {
        name: 'Hike',
        memberIds: [bob, carol],
      });

      expect(repository.addMember).toHaveBeenCalledWith(
        tripId,
        alice,
        TripMemberRole.ADMIN,
      );
      expect(repository.createInvite).toHaveBeenCalledTimes(1);
      expect(repository.createInvite).toHaveBeenCalledWith(tripId, alice, bob);
      expect(result.invites).toHaveLength(1);
    });
  });

  describe('invite', () => {
    it('forbids inviting a non-friend', async () => {
      repository.findTripById.mockResolvedValue({ id: tripId });
      repository.findMember
        .mockResolvedValueOnce(mockMember(alice))
        .mockResolvedValueOnce(null);
      friendshipsService.areAcceptedFriends.mockResolvedValue(false);

      await expect(
        service.invite(alice, tripId, { friendId: carol }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects inviting an existing member', async () => {
      repository.findTripById.mockResolvedValue({ id: tripId });
      repository.findMember
        .mockResolvedValueOnce(mockMember(alice))
        .mockResolvedValueOnce(mockMember(bob));

      await expect(
        service.invite(alice, tripId, { friendId: bob }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('respondInvite', () => {
    it('accepts an invite and adds the user as a member', async () => {
      repository.findInviteById.mockResolvedValue({
        id: 'inv-1',
        tripId,
        toId: bob,
        status: 'PENDING',
      });
      repository.findMember.mockResolvedValue(null);

      await service.respondInvite(bob, 'inv-1', { accept: true });

      expect(repository.addMember).toHaveBeenCalledWith(tripId, bob);
      expect(repository.updateInviteStatus).toHaveBeenCalledWith(
        'inv-1',
        'ACCEPTED',
        expect.any(Date),
      );
    });

    it('rejects invites addressed to others', async () => {
      repository.findInviteById.mockResolvedValue({
        id: 'inv-1',
        tripId,
        toId: alice,
        status: 'PENDING',
      });

      await expect(
        service.respondInvite(bob, 'inv-1', { accept: true }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('setMeetup', () => {
    it('fixes the meetup on a draft trip', async () => {
      repository.findTripById.mockResolvedValue({
        id: tripId,
        status: TripStatus.DRAFT,
        meetupName: null,
      });
      repository.findMember.mockResolvedValue(mockMember(alice));
      repository.updateTrip.mockResolvedValue({ id: tripId });

      const result = await service.setMeetup(alice, tripId, {
        lat: 35.8,
        lng: 10.6,
        name: 'Trailhead',
      });

      expect(repository.updateTrip).toHaveBeenCalledWith(
        tripId,
        expect.objectContaining({
          meetupLat: 35.8,
          meetupLng: 10.6,
          meetupFixedById: alice,
          meetupMode: 'FIXED',
          status: TripStatus.DECIDED,
        }),
      );
      expect(result.proposed).toBe(false);
    });

    it('creates a proposal on a decided trip', async () => {
      repository.findTripById.mockResolvedValue({
        id: tripId,
        status: TripStatus.DECIDED,
        meetupName: 'Old spot',
      });
      repository.findMember.mockResolvedValue(mockMember(alice));
      repository.updateTrip.mockResolvedValue({ id: tripId });

      const result = await service.setMeetup(alice, tripId, {
        lat: 35.9,
        lng: 10.7,
      });

      expect(repository.updateTrip).toHaveBeenCalledWith(
        tripId,
        expect.objectContaining({
          meetupProposalById: alice,
          meetupProposalLat: 35.9,
          meetupProposalName: 'Old spot',
        }),
      );
      expect(result.proposed).toBe(true);
    });
  });

  describe('respondProposal', () => {
    it('applies the proposal when another member accepts', async () => {
      repository.findTripById.mockResolvedValue({
        id: tripId,
        status: TripStatus.DECIDED,
        meetupName: 'Old spot',
        meetupProposalById: alice,
        meetupProposalLat: 35.9,
        meetupProposalLng: 10.7,
        meetupProposalName: 'New spot',
      });
      repository.findMember.mockResolvedValue(mockMember(bob));

      await service.respondProposal(bob, tripId, { accept: true });

      expect(repository.updateTrip).toHaveBeenCalledWith(
        tripId,
        expect.objectContaining({
          meetupLat: 35.9,
          meetupLng: 10.7,
          meetupFixedById: alice,
          meetupProposalById: null,
        }),
      );
    });

    it('forbids confirming your own proposal', async () => {
      repository.findTripById.mockResolvedValue({
        id: tripId,
        meetupProposalById: alice,
      });
      repository.findMember.mockResolvedValue(mockMember(alice));

      await expect(
        service.respondProposal(alice, tripId, { accept: true }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('membership guards', () => {
    it('throws not-found for unknown trips', async () => {
      repository.findTripById.mockResolvedValue(null);

      await expect(service.getDetail(alice, tripId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws forbidden for non-members', async () => {
      repository.findTripById.mockResolvedValue({ id: tripId });
      repository.findMember.mockResolvedValue(null);

      await expect(service.getDetail(alice, tripId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('only lets admins archive and delete', async () => {
      repository.findTripById.mockResolvedValue({ id: tripId });
      repository.findMember.mockResolvedValue(mockMember(alice, TripMemberRole.MEMBER));

      await expect(service.archive(alice, tripId)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.delete(alice, tripId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});