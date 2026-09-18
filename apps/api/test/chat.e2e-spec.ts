import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import { AppModule } from './../src/app.module';

describe('Chat + presence (e2e)', () => {
  let app: INestApplication;
  let port: number;
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;

    aliceToken = await login('alice');
    bobToken = await login('bob');
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(identifier: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier, password: 'password123' })
      .expect(200);
    return res.body.access_token as string;
  }

  async function connectAs(token: string): Promise<Socket> {
    const socket = io(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('socket connection timed out')),
        3000,
      );
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    return socket;
  }

  async function friendId(token: string, username: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/friendships')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const friendship = (
      res.body as { friend: { id: string; username: string } }[]
    ).find((f) => f.friend.username === username);
    if (!friendship) throw new Error(`friend ${username} not found`);
    return friendship.friend.id;
  }

  it('delivers a message between accepted friends and persists it', async () => {
    const alice = await connectAs(aliceToken);
    const bob = await connectAs(bobToken);

    try {
      const bobFriendId = await friendId(aliceToken, 'bob');

      const received = await new Promise<{
        id: string;
        senderId: string;
        body: string;
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('no message:new received')),
          3000,
        );
        bob.once('message:new', (data) => {
          clearTimeout(timer);
          resolve(data as { id: string; senderId: string; body: string });
        });
        alice.emit('message:send', {
          recipientId: bobFriendId,
          body: 'hello bob',
        });
      });

      expect(received.body).toBe('hello bob');
      expect(received.senderId).toBeDefined();

      const history = await request(app.getHttpServer())
        .get(`/messages/${received.senderId}`)
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(200);
      expect(history.body as { body: string }[]).toEqual(
        expect.arrayContaining([expect.objectContaining({ body: 'hello bob' })]),
      );
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('forbids messaging non-friends', async () => {
    const alice = await connectAs(aliceToken);

    try {
      const stranger = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `stranger-${Date.now()}@test.dev`,
          username: `stranger${Date.now()}`.slice(0, 20),
          password: 'password123',
        })
        .expect(201);

      const strangerId = (
        JSON.parse(
          Buffer.from(
            (stranger.body.access_token as string).split('.')[1],
            'base64url',
          ).toString('utf8'),
        ) as { sub: string }
      ).sub;

      const rejected = await new Promise<boolean>((resolve) => {
        alice.once('message:error', () => resolve(true));
        alice.once('message:sent', () => resolve(false));
        alice.emit('message:send', {
          recipientId: strangerId,
          body: 'hi stranger',
        });
        setTimeout(() => resolve(true), 1000);
      });
      expect(rejected).toBe(true);
    } finally {
      alice.disconnect();
    }
  });

  it('broadcasts presence when a friend connects and disconnects', async () => {
    const aliceId = await friendId(bobToken, 'alice');
    const bob = await connectAs(bobToken);
    await sleep(500);

    const updates: { userId: string; online: boolean }[] = [];
    bob.on('presence:update', (data) => {
      updates.push(data as { userId: string; online: boolean });
    });

    const alice = await connectAs(aliceToken);
    await sleep(500);

    const readPresence = () =>
      new Promise<{ onlineUserIds: string[] }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('no presence:snapshot received')),
          3000,
        );
        bob.once('presence:snapshot', (data) => {
          clearTimeout(timer);
          resolve(data as { onlineUserIds: string[] });
        });
        bob.emit('presence:snapshot');
      });

    const online = await readPresence();
    expect(online.onlineUserIds).toContain(aliceId);

    alice.disconnect();
    await sleep(1000);

    const offline = await readPresence();
    expect(offline.onlineUserIds).not.toContain(aliceId);

    expect(
      updates.some((u) => u.userId === aliceId && u.online),
    ).toBe(true);
    expect(
      updates.some((u) => u.userId === aliceId && !u.online),
    ).toBe(true);

    try {
      bob.disconnect();
    } finally {
      alice.disconnect();
    }
  });

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
});