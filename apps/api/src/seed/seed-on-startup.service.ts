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
    [35.828, 10.64],
    [35.829, 10.641],
    [35.83, 10.642],
    [35.831, 10.643],
  ],
  bob: [
    [35.845, 10.595],
    [35.846, 10.596],
    [35.847, 10.597],
    [35.848, 10.598],
  ],
  carol: [
    [35.826, 10.635],
    [35.827, 10.636],
    [35.828, 10.637],
    [35.829, 10.638],
  ],
  dave: [
    [35.82, 10.63],
    [35.821, 10.631],
    [35.822, 10.632],
    [35.823, 10.633],
  ],
  erin: [
    [35.855, 10.585],
    [35.856, 10.586],
    [35.857, 10.587],
    [35.858, 10.588],
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
