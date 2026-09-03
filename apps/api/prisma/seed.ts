import { PrismaPg } from '@prisma/adapter-pg';
import {
  FriendshipStatus,
  PrismaClient,
  SharingListType,
  SharingMode,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set to run the seed script');
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });
const password = 'password123';
const demoEmails = [
  'alice@friendmap.dev',
  'bob@friendmap.dev',
  'carol@friendmap.dev',
  'dave@friendmap.dev',
  'erin@friendmap.dev',
];
const sharingModes = {
  alice: 'EVERYONE',
  bob: 'SELECTED',
  carol: 'EXCEPT_SELECTED',
  dave: 'GHOST',
  erin: 'GHOST (default)',
} as const;

async function main() {
  await prisma.user.deleteMany({ where: { email: { in: demoEmails } } });

  const passwordHash = await bcrypt.hash(password, 10);
  const users = Object.fromEntries(
    await Promise.all(
      ['alice', 'bob', 'carol', 'dave', 'erin'].map(async (username) => [
        username,
        await prisma.user.create({
          data: {
            email: `${username}@friendmap.dev`,
            username,
            passwordHash,
          },
        }),
      ]),
    ),
  );

  const acceptedEdges = [
    ['alice', 'bob'],
    ['alice', 'carol'],
    ['bob', 'carol'],
    ['bob', 'dave'],
    ['carol', 'erin'],
  ] as const;
  await prisma.friendship.createMany({
    data: acceptedEdges.map(([requester, addressee]) => ({
      requesterId: users[requester].id,
      addresseeId: users[addressee].id,
      status: FriendshipStatus.ACCEPTED,
    })),
  });
  await prisma.friendship.create({
    data: {
      requesterId: users.dave.id,
      addresseeId: users.erin.id,
      status: FriendshipStatus.PENDING,
    },
  });

  await prisma.sharingSettings.createMany({
    data: [
      { userId: users.alice.id, mode: SharingMode.EVERYONE },
      { userId: users.bob.id, mode: SharingMode.SELECTED },
      { userId: users.carol.id, mode: SharingMode.EXCEPT_SELECTED },
      { userId: users.dave.id, mode: SharingMode.GHOST },
    ],
  });
  await prisma.sharingListEntry.createMany({
    data: [
      {
        ownerId: users.bob.id,
        friendId: users.carol.id,
        listType: SharingListType.SELECTED,
      },
      {
        ownerId: users.carol.id,
        friendId: users.alice.id,
        listType: SharingListType.EXCEPT,
      },
    ],
  });

  const now = Date.now();
  const demoTrails = {
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
  } as const;

  await prisma.locationHistoryPoint.createMany({
    data: (Object.keys(demoTrails) as Array<keyof typeof demoTrails>).flatMap(
      (username) =>
        demoTrails[username].map(([lat, lng], index) => {
          const recordedAt = new Date(now - (demoTrails[username].length - index) * 10 * 60_000);
          return {
            userId: users[username].id,
            lat,
            lng,
            accuracy: 8,
            recordedAt,
            expiresAt: new Date(recordedAt.getTime() + 24 * 60 * 60_000),
          };
        }),
    ),
  });

  console.table(
    (['alice', 'bob', 'carol', 'dave', 'erin'] as const).map((username) => ({
      username,
      email: users[username].email,
      password,
      sharingMode: sharingModes[username],
    })),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
