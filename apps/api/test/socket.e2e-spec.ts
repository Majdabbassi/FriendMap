import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import { AppModule } from './../src/app.module';

describe('Location socket (e2e)', () => {
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

  it('rejects connections with an invalid token', async () => {
    const socket = io(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: { token: 'not-a-valid-jwt' },
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('socket was not disconnected by the server')),
        3000,
      );
      socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.once('disconnect', (reason) => {
        clearTimeout(timer);
        if (reason === 'io server disconnect') resolve();
        else reject(new Error(`unexpected disconnect reason: ${reason}`));
      });
    });

    socket.disconnect();
  });

  it('broadcasts location updates to authorized friends', async () => {
    const alice = await connectAs(aliceToken);
    const bob = await connectAs(bobToken);

    try {
      const snapshot = await new Promise<unknown[]>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('no location:snapshot received')),
          3000,
        );
        bob.once('location:snapshot', (data: unknown[]) => {
          clearTimeout(timer);
          resolve(data);
        });
        bob.emit('view:friends');
      });
      expect(Array.isArray(snapshot)).toBe(true);

      const update = await new Promise<{ userId: string; lat: number; lng: number }>(
        (resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('no location:update received')),
            3000,
          );
          bob.once('location:update', (data) => {
            clearTimeout(timer);
            resolve(data);
          });
          alice.emit('location:update', {
            lat: 36.8,
            lng: 10.2,
            accuracy: 5,
            timestamp: Date.now(),
          });
        },
      );

      expect(update.userId).toBeDefined();
      expect(update.lat).toBe(36.8);
      expect(update.lng).toBe(10.2);
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('allows a viewer to stop and resume viewing a friend', async () => {
    const alice = await connectAs(aliceToken);
    const bob = await connectAs(bobToken);

    try {
      const snapshot = await new Promise<{ userId: string }[]>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('no location:snapshot received')),
          3000,
        );
        bob.once('location:snapshot', (data) => {
          clearTimeout(timer);
          resolve(data as { userId: string }[]);
        });
        bob.emit('view:friends');
      });
      const aliceId = snapshot.find((entry) => entry.userId)?.userId;
      expect(aliceId).toBeDefined();

      await new Promise<void>((resolve) => {
        bob.emit('view:stop', { friendId: aliceId });
        setTimeout(resolve, 150);
      });

      let hiddenNotified = false;
      bob.once('location:hidden', () => {
        hiddenNotified = true;
      });
      alice.emit('location:update', {
        lat: 36.9,
        lng: 10.3,
        accuracy: 5,
        timestamp: Date.now(),
      });
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(hiddenNotified).toBe(false);

      const resumed = await new Promise<{ userId: string }[] | null>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(null);
          }
        }, 750);
        bob.once('location:snapshot', (data) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(data as { userId: string }[]);
          }
        });
        bob.emit('view:start', { friendId: aliceId });
      });
      expect(resumed).toEqual(
        expect.arrayContaining([expect.objectContaining({ userId: aliceId })]),
      );
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });
});
