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
