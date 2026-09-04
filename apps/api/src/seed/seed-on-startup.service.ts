import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { FriendshipStatus, SharingListType, SharingMode } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

const demoPassword = 'password123';
const demoUsers = ['alice', 'bob', 'carol', 'dave', 'erin'] as const;
const demoEmails = demoUsers.map((username) => `${username}@friendmap.dev`);

const acceptedEdges: ReadonlyArray<readonly [string, string]> = [
  ['alice', 'bob'],
  ['alice', 'carol'],
  ['bob', 'carol'],
  ['bob', 'dave'],
  ['carol', 'erin'],
];

const sharingModes: Record<string, SharingMode> = {
  alice: SharingMode.EVERYONE,
  bob: SharingMode.SELECTED,
  carol: SharingMode.EXCEPT_SELECTED,
  dave: SharingMode.GHOST,
};

const sharingListEntries: ReadonlyArray<{
  owner: string;
  friend: string;
  listType: SharingListType;
}> = [
  { owner: 'bob', friend: 'carol', listType: SharingListType.SELECTED },
  { owner: 'carol', friend: 'alice', listType: SharingListType.EXCEPT },
];

const demoTrails: Record<string, ReadonlyArray<readonly [number, number]>> = {
  alice: [
    [31.9539, 35.9106],
    [31.9548, 35.9121],
    [31.956, 35.9137],
    [31.9572, 35.9153],
  ],
  bob: [
    [31.9632, 35.9304],
    [31.9641, 35.932],
    [31.9654, 35.9335],
    [31.9665, 35.9352],
  ],
  carol: [
    [31.9458, 35.8847],
    [31.9467, 35.8861],
    [31.9478, 35.8875],
    [31.949, 35.889],
  ],
  dave: [
    [31.9781, 35.8662],
    [31.979, 35.8676],
    [31.9802, 35.8691],
    [31.9813, 35.8708],
  ],
  erin: [
    [31.9254, 35.928],
    [31.9265, 35.9294],
    [31.9276, 35.931],
    [31.9287, 35.9325],
  ],
};

@Injectable()
export class SeedOnStartupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedOnStartupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.resetAndSeed();
  }

  private async resetAndSeed(): Promise<void> {
    const passwordHash = await bcrypt.hash(demoPassword, 10);

    await this.prisma.locationHistoryPoint.deleteMany({
      where: { user: { email: { in: demoEmails } } },
    });
    await this.prisma.sharingListEntry.deleteMany({
      where: { owner: { email: { in: demoEmails } } },
    });
    await this.prisma.sharingSettings.deleteMany({
      where: { user: { email: { in: demoEmails } } },
    });
    await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { requester: { email: { in: demoEmails } } },
          { addressee: { email: { in: demoEmails } } },
        ],
      },
    });

    const ids = await this.upsertUsers(passwordHash);

    const edgeData = acceptedEdges.map(([requester, addressee]) =>
      this.prisma.friendship.create({
        data: {
          requesterId: ids[requester],
          addresseeId: ids[addressee],
          status: FriendshipStatus.ACCEPTED,
        },
      }),
    );
    edgeData.push(
      this.prisma.friendship.create({
        data: {
          requesterId: ids.dave,
          addresseeId: ids.erin,
          status: FriendshipStatus.PENDING,
        },
      }),
    );

    const settingsData = demoUsers
      .filter((username) => sharingModes[username])
      .map((username) =>
        this.prisma.sharingSettings.create({
          data: { userId: ids[username], mode: sharingModes[username] },
        }),
      );

    const listData = sharingListEntries.map(({ owner, friend, listType }) =>
      this.prisma.sharingListEntry.create({
        data: { ownerId: ids[owner], friendId: ids[friend], listType },
      }),
    );

    const now = Date.now();
    const historyData = demoUsers.flatMap((username) =>
      demoTrails[username].map(([lat, lng], index) => {
        const recordedAt = new Date(
          now - (demoTrails[username].length - index) * 10 * 60_000,
        );
        return this.prisma.locationHistoryPoint.create({
          data: {
            userId: ids[username],
            lat,
            lng,
            accuracy: 8,
            recordedAt,
            expiresAt: new Date(recordedAt.getTime() + 24 * 60 * 60_000),
          },
        });
      }),
    );

    await Promise.all([
      ...edgeData,
      ...settingsData,
      ...listData,
      ...historyData,
    ]);

    this.logger.log('Demo data seeded.');
    console.table(
      demoUsers.map((username) => ({
        username,
        email: ids[username] ? `${username}@friendmap.dev` : '',
        password: demoPassword,
        sharingMode: sharingModes[username] ?? 'GHOST (default)',
      })),
    );
  }

  private async upsertUsers(
    passwordHash: string,
  ): Promise<Record<string, string>> {
    const users: Record<string, string> = {};
    await Promise.all(
      demoUsers.map(async (username) => {
        const user = await this.prisma.user.upsert({
          where: { email: `${username}@friendmap.dev` },
          update: {},
          create: {
            email: `${username}@friendmap.dev`,
            username,
            passwordHash,
          },
        });
        users[username] = user.id;
      }),
    );
    return users;
  }
}
