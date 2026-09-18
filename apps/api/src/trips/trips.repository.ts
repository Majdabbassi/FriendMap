import { Injectable } from '@nestjs/common';
import {
  Trip,
  TripInvite,
  TripInviteStatus,
  TripMember,
  TripMemberRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const publicUserSelect = {
  id: true,
  username: true,
  email: true,
} as const;

@Injectable()
export class TripsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createTrip(data: {
    name: string;
    createdById: string;
    meetupLat?: number | null;
    meetupLng?: number | null;
    meetupName?: string | null;
    meetingTime?: string | null;
  }): Promise<Trip> {
    return this.prisma.trip.create({
      data: {
        name: data.name,
        createdById: data.createdById,
        meetupLat: data.meetupLat ?? null,
        meetupLng: data.meetupLng ?? null,
        meetupName: data.meetupName ?? null,
        meetupFixedById: data.meetupLat != null ? data.createdById : null,
        meetupMode: data.meetupLat != null ? 'FIXED' : 'AUTO',
        meetingTime: data.meetingTime ? new Date(data.meetingTime) : null,
      },
    });
  }

  async findTripById(id: string): Promise<Trip | null> {
    return this.prisma.trip.findUnique({ where: { id } });
  }

  async updateTrip(id: string, data: Partial<Trip>): Promise<Trip> {
    return this.prisma.trip.update({ where: { id }, data });
  }

  async deleteTrip(id: string): Promise<void> {
    await this.prisma.trip.delete({ where: { id } });
  }

  async addMember(
    tripId: string,
    userId: string,
    role: TripMemberRole = TripMemberRole.MEMBER,
  ): Promise<TripMember> {
    return this.prisma.tripMember.create({
      data: { tripId, userId, role },
    });
  }

  async removeMember(tripId: string, userId: string): Promise<void> {
    await this.prisma.tripMember.deleteMany({
      where: { tripId, userId },
    });
  }

  async findMembers(tripId: string): Promise<
    Array<TripMember & { user: { id: string; username: string; email: string } }>
  > {
    return this.prisma.tripMember.findMany({
      where: { tripId },
      include: { user: { select: publicUserSelect } },
    });
  }

  async findMember(tripId: string, userId: string): Promise<TripMember | null> {
    return this.prisma.tripMember.findUnique({
      where: { tripId_userId: { tripId, userId } },
    });
  }

  async memberIds(tripId: string): Promise<string[]> {
    const members = await this.prisma.tripMember.findMany({
      where: { tripId },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  async listTripsForUser(
    userId: string,
  ): Promise<
    Array<
      Trip & { members: Array<{ userId: string; arrivedAt: Date | null }> }
    >
  > {
    return this.prisma.trip.findMany({
      where: {
        OR: [{ createdById: userId }, { members: { some: { userId } } }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        members: {
          select: { userId: true, arrivedAt: true },
        },
      },
    });
  }

  async findPendingInvitesForTrip(
    tripId: string,
  ): Promise<
    Array<
      TripInvite & { to: { id: string; username: string; email: string } }
    >
  > {
    return this.prisma.tripInvite.findMany({
      where: { tripId, status: TripInviteStatus.PENDING },
      include: {
        to: { select: publicUserSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPendingInvitesFor(userId: string): Promise<
    Array<
      TripInvite & {
        trip: Trip;
        from: { id: string; username: string; email: string };
      }
    >
  > {
    return this.prisma.tripInvite.findMany({
      where: { toId: userId, status: TripInviteStatus.PENDING },
      include: {
        trip: true,
        from: { select: publicUserSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findInviteById(id: string): Promise<TripInvite | null> {
    return this.prisma.tripInvite.findUnique({ where: { id } });
  }

  async createInvite(
    tripId: string,
    fromId: string,
    toId: string,
  ): Promise<TripInvite> {
    return this.prisma.tripInvite.create({
      data: { tripId, fromId, toId },
    });
  }

  async updateInviteStatus(
    id: string,
    status: TripInviteStatus,
    respondedAt: Date,
  ): Promise<TripInvite> {
    return this.prisma.tripInvite.update({
      where: { id },
      data: { status, respondedAt },
    });
  }

  async findMessages(tripId: string, limit = 50): Promise<unknown[]> {
    return this.prisma.tripMessage.findMany({
      where: { tripId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async saveTripMessage(tripId: string, senderId: string, body: string) {
    return this.prisma.tripMessage.create({
      data: { tripId, senderId, body },
    });
  }

  async setArrived(tripId: string, userId: string, arrivedAt: Date) {
    return this.prisma.tripMember.update({
      where: { tripId_userId: { tripId, userId } },
      data: { arrivedAt },
    });
  }
}