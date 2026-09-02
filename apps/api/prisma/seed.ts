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
  erin: 'EVERYONE (default)',
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
