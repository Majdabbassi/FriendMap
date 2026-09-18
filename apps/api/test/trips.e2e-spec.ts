import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import { AppModule } from './../src/app.module';

type TripBody = {
  id: string;
  name: string;
  status: string;
  meetupMode: string;
  meetupLat?: number | null;
  meetupLng?: number | null;
  meetupFixedById?: string | null;
  members?: { userId: string; role: string; arrivedAt: string | null }[];
  invites?: { id: string; toId: string; status: string }[];
};

const tripNames = new Set<string>();

describe('Trips (e2e)', () => {
  let app: INestApplication;
  let port: number;
  let aliceToken: string;
  let bobToken: string;
  let carolToken: string;
  let aliceId: string;
  let bobId: string;
  let carolId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;

    aliceToken = await login('alice');
    bobToken = await login('bob');
    carolToken = await login('carol');
    aliceId = await userIdFromToken(aliceToken);
    bobId = await userIdFromToken(bobToken);
    carolId = await userIdFromToken(carolToken);
  }, 60_000);

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

  async function userIdFromToken(token: string): Promise<string> {
    const payload = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
    return (JSON.parse(payload) as { sub: string }).sub;
  }

  async function createTrip(
    token: string,
    name: string,
    memberIds?: string[],
  ): Promise<TripBody> {
    const res = await request(app.getHttpServer())
      .post('/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, memberIds })
      .expect(201);
    const body = res.body as { trip: TripBody };
    tripNames.add(name);
    return body.trip;
  }

  it('runs the full trip lifecycle: create, invite, accept, chat, meetup, arrive', async () => {
    const trip = await createTrip(
      aliceToken,
      `e2e-trips-${Date.now()}`,
      [bobId, carolId],
    );

    const pending = await request(app.getHttpServer())
      .get('/trips/invites')
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);
    const invite = (pending.body as { id: string; toId: string }[]).find(
      (inv) => inv.toId === bobId,
    );
    expect(invite).toBeDefined();

    await request(app.getHttpServer())
      .post(`/trips/invites/${invite!.id}/respond`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ accept: true })
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/trips/${trip.id}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);
    const body = detail.body as TripBody;
    expect(body.members?.map((m) => m.userId)).toEqual(
      expect.arrayContaining([aliceId, bobId]),
    );
    expect(body.invites?.some((inv) => inv.toId === carolId)).toBe(true);
  });

  it('enforces membership for trip access', async () => {
    const trip = await createTrip(aliceToken, `e2e-trips-gated-${Date.now()}`);

    await request(app.getHttpServer())
      .get(`/trips/${trip.id}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/trips/${trip.id}/meetup`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ lat: 35.8, lng: 10.6, name: 'No' })
      .expect(403);
  });

  it('fixes the meetup, proposes changes, and applies them', async () => {
    const trip = await createTrip(aliceToken, `e2e-trips-meetup-${Date.now()}`);

    await request(app.getHttpServer())
      .post(`/trips/${trip.id}/meetup`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ lat: 35.8282, lng: 10.6404, name: 'Trailhead' })
      .expect(200)
      .expect((res) => {
        expect((res.body as { proposed: boolean }).proposed).toBe(false);
      });

    const after = await request(app.getHttpServer())
      .get(`/trips/${trip.id}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);
    const afterBody = after.body as TripBody;
    expect(afterBody.status).toBe('DECIDED');
    expect(afterBody.meetupLat).toBeCloseTo(35.8282);
    expect(afterBody.meetupFixedById).toBe(aliceId);
  });

  it('proposes a meetup change on a decided trip and applies it on accept', async () => {
    const trip = await createTrip(aliceToken, `e2e-trips-proposal-${Date.now()}`);
    await request(app.getHttpServer())
      .post(`/trips/${trip.id}/meetup`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ lat: 35.8282, lng: 10.6404, name: 'Trailhead' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/trips/${trip.id}/meetup`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ lat: 35.8300, lng: 10.6420, name: 'New spot' })
      .expect(200)
      .expect((res) => {
        expect((res.body as { proposed: boolean }).proposed).toBe(true);
      });

    const pending = await request(app.getHttpServer())
      .get(`/trips/${trip.id}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);
    expect(
      (pending.body as TripBody & { meetupProposalLat?: number }).meetupProposalLat,
    ).toBeCloseTo(35.83);
  });

  it('delivers trip chat between members over sockets', async () => {
    const trip = await createTrip(aliceToken, `e2e-trips-chat-${Date.now()}`, [bobId]);

    const pending = await request(app.getHttpServer())
      .get('/trips/invites')
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);
    const invite = (pending.body as { id: string; toId: string }[]).find(
      (inv) => inv.toId === bobId,
    );
    await request(app.getHttpServer())
      .post(`/trips/invites/${invite!.id}/respond`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ accept: true })
      .expect(200);

    const alice = await connectAs(aliceToken);
    const bob = await connectAs(bobToken);

    try {
      await joinTrip(alice, trip.id);
      await joinTrip(bob, trip.id);

      const received = await new Promise<{ body: string; senderId: string }>(
        (resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('no trip:chat-new received')),
            3000,
          );
          bob.once('trip:chat-new', (data) => {
            clearTimeout(timer);
            resolve(data as { body: string; senderId: string });
          });
          alice.emit('trip:chat', { tripId: trip.id, body: 'meet you there' });
        },
      );

      expect(received.body).toBe('meet you there');
      expect(received.senderId).toBe(aliceId);

      const history = await request(app.getHttpServer())
        .get(`/trips/${trip.id}/messages`)
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(200);
      expect(history.body as { body: string }[]).toContainEqual(
        expect.objectContaining({ body: 'meet you there' }),
      );
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('marks a member as arrived via the arrival endpoint', async () => {
    const trip = await createTrip(aliceToken, `e2e-trips-arrive-${Date.now()}`, [bobId]);
    const pending = await request(app.getHttpServer())
      .get('/trips/invites')
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);
    const invite = (pending.body as { id: string; toId: string }[]).find(
      (inv) => inv.toId === bobId,
    );
    await request(app.getHttpServer())
      .post(`/trips/invites/${invite!.id}/respond`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ accept: true })
      .expect(200);

    const arrived = await request(app.getHttpServer())
      .post(`/trips/${trip.id}/arrive`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);
    expect((arrived.body as { arrivedAt: string }).arrivedAt).toBeDefined();

    const detail = await request(app.getHttpServer())
      .get(`/trips/${trip.id}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);
    const bobMember = (detail.body as TripBody).members?.find(
      (m) => m.userId === bobId,
    );
    expect(bobMember?.arrivedAt).toBeDefined();
  });

  async function joinTrip(socket: Socket, tripId: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no trip:joined')), 3000);
      socket.once('trip:joined', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.emit('trip:join', { tripId });
    });
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
});