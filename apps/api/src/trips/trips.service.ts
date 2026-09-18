import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TripInviteStatus, TripMemberRole, TripStatus } from '@prisma/client';
import { FriendshipsService } from '../friendships/friendships.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { InviteToTripDto, RespondInviteDto, RespondProposalDto, SetMeetupDto } from './dto/trip-actions.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripsRepository } from './trips.repository';

@Injectable()
export class TripsService {
  constructor(
    private readonly tripsRepository: TripsRepository,
    private readonly friendshipsService: FriendshipsService,
  ) {}

  async create(userId: string, dto: CreateTripDto) {
    const trip = await this.tripsRepository.createTrip({
      name: dto.name,
      createdById: userId,
      meetupLat: dto.meetupLat ?? null,
      meetupLng: dto.meetupLng ?? null,
      meetupName: dto.meetupName ?? null,
      meetingTime: dto.meetingTime ?? null,
    });

    await this.tripsRepository.addMember(trip.id, userId, TripMemberRole.ADMIN);

    const invites: unknown[] = [];
    for (const friendId of dto.memberIds ?? []) {
      if (friendId === userId) continue;
      if (await this.tripsRepository.findMember(trip.id, friendId)) continue;
      const areFriends =
        await this.friendshipsService.areAcceptedFriends(userId, friendId);
      if (!areFriends) continue;
      invites.push(await this.tripsRepository.createInvite(trip.id, userId, friendId));
    }

    return { trip, invites };
  }

  async listMine(userId: string) {
    const trips = await this.tripsRepository.listTripsForUser(userId);
    return trips.map((trip) => ({
      ...trip,
      memberCount: trip.members.length,
    }));
  }

  async getDetail(userId: string, tripId: string) {
    const trip = await this.requireMembership(userId, tripId);
    const members = await this.tripsRepository.findMembers(tripId);
    const invites = await this.tripsRepository.findPendingInvitesForTrip(tripId);
    return { ...trip, members, invites };
  }

  async update(userId: string, tripId: string, dto: UpdateTripDto) {
    await this.requireMembership(userId, tripId);
    if (dto.name !== undefined) {
      await this.requireAdmin(userId, tripId);
    }
    return this.tripsRepository.updateTrip(tripId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.meetingTime !== undefined
        ? { meetingTime: dto.meetingTime ? new Date(dto.meetingTime) : null }
        : {}),
    });
  }

  async archive(userId: string, tripId: string) {
    await this.requireAdmin(userId, tripId);
    return this.tripsRepository.updateTrip(tripId, {
      status: TripStatus.ARCHIVED,
      archivedAt: new Date(),
    });
  }

  async delete(userId: string, tripId: string) {
    await this.requireAdmin(userId, tripId);
    await this.tripsRepository.deleteTrip(tripId);
    return { deleted: true };
  }

  async leave(userId: string, tripId: string) {
    const member = await this.tripsRepository.findMember(tripId, userId);
    if (!member) {
      throw new ForbiddenException('You are not a member of this trip');
    }
    await this.tripsRepository.removeMember(tripId, userId);
    return { left: true };
  }

  async invite(userId: string, tripId: string, dto: InviteToTripDto) {
    await this.requireMembership(userId, tripId);
    const friendId = dto.friendId;

    if (friendId === userId) {
      throw new BadRequestException('You are already a member of this trip');
    }
    if (await this.tripsRepository.findMember(tripId, friendId)) {
      throw new BadRequestException('This friend is already a member');
    }
    const areFriends =
      await this.friendshipsService.areAcceptedFriends(userId, friendId);
    if (!areFriends) {
      throw new ForbiddenException('You can only invite accepted friends');
    }

    try {
      return await this.tripsRepository.createInvite(tripId, userId, friendId);
    } catch {
      // Unique (tripId, toId) constraint: an invite is already pending.
      throw new BadRequestException('An invite for this friend is already pending');
    }
  }

  async listIncomingInvites(userId: string) {
    return this.tripsRepository.listPendingInvitesFor(userId);
  }

  async respondInvite(userId: string, inviteId: string, dto: RespondInviteDto) {
    const invite = await this.tripsRepository.findInviteById(inviteId);
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.toId !== userId) {
      throw new ForbiddenException('This invite was not addressed to you');
    }
    if (invite.status !== TripInviteStatus.PENDING) {
      throw new BadRequestException('This invite was already handled');
    }

    if (dto.accept) {
      if (!(await this.tripsRepository.findMember(invite.tripId, userId))) {
        await this.tripsRepository.addMember(invite.tripId, userId);
      }
      return this.tripsRepository.updateInviteStatus(
        inviteId,
        TripInviteStatus.ACCEPTED,
        new Date(),
      );
    }

    return this.tripsRepository.updateInviteStatus(
      inviteId,
      TripInviteStatus.DECLINED,
      new Date(),
    );
  }

  async messages(userId: string, tripId: string) {
    await this.requireMembership(userId, tripId);
    const messages = await this.tripsRepository.findMessages(tripId);
    return (messages as { createdAt: Date }[]).reverse();
  }

  async sendTripMessage(userId: string, tripId: string, body: string) {
    await this.requireMembership(userId, tripId);
    return this.tripsRepository.saveTripMessage(tripId, userId, body);
  }

  async setMeetup(userId: string, tripId: string, dto: SetMeetupDto) {
    const trip = await this.requireMembership(userId, tripId);
    if (trip.status === TripStatus.ARCHIVED) {
      throw new BadRequestException('This trip is archived');
    }

    if (trip.status === TripStatus.DECIDED) {
      const updated = await this.tripsRepository.updateTrip(tripId, {
        meetupProposalById: userId,
        meetupProposalLat: dto.lat,
        meetupProposalLng: dto.lng,
        meetupProposalName: dto.name ?? trip.meetupName,
      });
      return { trip: updated, proposed: true };
    }

    const updated = await this.tripsRepository.updateTrip(tripId, {
      meetupLat: dto.lat,
      meetupLng: dto.lng,
      meetupName: dto.name ?? null,
      meetupFixedById: userId,
      meetupMode: 'FIXED',
      status: TripStatus.DECIDED,
      meetupProposalById: null,
      meetupProposalLat: null,
      meetupProposalLng: null,
      meetupProposalName: null,
    });
    return { trip: updated, proposed: false };
  }

  async respondProposal(userId: string, tripId: string, dto: RespondProposalDto) {
    const trip = await this.requireMembership(userId, tripId);
    if (!trip.meetupProposalById) {
      throw new BadRequestException('No meetup proposal is pending');
    }
    if (trip.meetupProposalById === userId) {
      throw new BadRequestException('You cannot confirm your own proposal');
    }

    if (dto.accept) {
      return this.tripsRepository.updateTrip(tripId, {
        meetupLat: trip.meetupProposalLat,
        meetupLng: trip.meetupProposalLng,
        meetupName: trip.meetupProposalName ?? trip.meetupName,
        meetupFixedById: trip.meetupProposalById,
        meetupMode: 'FIXED',
        meetupProposalById: null,
        meetupProposalLat: null,
        meetupProposalLng: null,
        meetupProposalName: null,
      });
    }

    return this.tripsRepository.updateTrip(tripId, {
      meetupProposalById: null,
      meetupProposalLat: null,
      meetupProposalLng: null,
      meetupProposalName: null,
    });
  }

  async arrive(userId: string, tripId: string) {
    await this.requireMembership(userId, tripId);
    return this.tripsRepository.setArrived(tripId, userId, new Date());
  }

  private async requireMembership(userId: string, tripId: string) {
    const trip = await this.tripsRepository.findTripById(tripId);
    if (!trip) {
      throw new NotFoundException('Trip not found');
    }
    const membership = await this.tripsRepository.findMember(tripId, userId);
    if (!membership) {
      throw new ForbiddenException('You are not a member of this trip');
    }
    return trip;
  }

  private async requireAdmin(userId: string, tripId: string) {
    const membership = await this.tripsRepository.findMember(tripId, userId);
    if (!membership) {
      throw new ForbiddenException('You are not a member of this trip');
    }
    if (membership.role !== TripMemberRole.ADMIN) {
      throw new ForbiddenException('Only the trip organizer can do this');
    }
  }
}