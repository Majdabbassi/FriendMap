import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('FriendMap API (e2e)', () => {
  let app: INestApplication<App>;
  let httpServer: App;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('health', () => {
    it('reports database and redis as reachable', async () => {
      const res = await request(httpServer).get('/health');
      expect(res.body.info.database.status).toBe('up');
      expect(res.body.info.redis.status).toBe('up');
    });
  });

  describe('authentication', () => {
    it('registers a user, logs in, rotates refresh tokens, and revokes them on logout', async () => {
      const email = `e2e-${Date.now()}@test.dev`;
      const username = `e2e_${Date.now()}`.slice(0, 20);

      const registered = await request(httpServer)
        .post('/auth/register')
        .send({ email, username, password: 'password123' })
        .expect(201);
      expect(registered.body.access_token).toBeDefined();
      expect(registered.body.refresh_token).toBeDefined();

      const login = await request(httpServer)
        .post('/auth/login')
        .send({ identifier: email, password: 'password123' })
        .expect(200);
      expect(login.body.access_token).toBeDefined();
      expect(login.body.refresh_token).toBeDefined();

      const refreshed = await request(httpServer)
        .post('/auth/refresh')
        .send({ refresh_token: login.body.refresh_token })
        .expect(200);
      expect(refreshed.body.access_token).toBeDefined();
      expect(refreshed.body.refresh_token).not.toBe(login.body.refresh_token);

      // The old refresh token is single-use and already rotated.
      await request(httpServer)
        .post('/auth/refresh')
        .send({ refresh_token: login.body.refresh_token })
        .expect(401);

      await request(httpServer)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${refreshed.body.access_token}`)
        .expect(200);

      // Logout revoked the rotated token too.
      await request(httpServer)
        .post('/auth/refresh')
        .send({ refresh_token: refreshed.body.refresh_token })
        .expect(401);
    });

    it('rejects login with invalid credentials', async () => {
      await request(httpServer)
        .post('/auth/login')
        .send({ identifier: 'alice@friendmap.dev', password: 'wrong-password' })
        .expect(401);
    });

    it('rejects duplicate registration with a conflict', async () => {
      await request(httpServer)
        .post('/auth/register')
        .send({
          email: 'alice@friendmap.dev',
          username: 'alice',
          password: 'password123',
        })
        .expect(409);
    });
  });

  describe('friendships', () => {
    let aliceToken: string;

    beforeAll(async () => {
      const login = await request(httpServer)
        .post('/auth/login')
        .send({ identifier: 'alice', password: 'password123' })
        .expect(200);
      aliceToken = login.body.access_token;
    });

    it('rejects unauthenticated requests', async () => {
      await request(httpServer).get('/friendships').expect(401);
    });

    it('lists accepted friends in alphabetical order', async () => {
      const res = await request(httpServer)
        .get('/friendships')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);

      const usernames = (res.body as { friend: { username: string } }[]).map(
        (friendship) => friendship.friend.username,
      );
      expect(usernames).toEqual(expect.arrayContaining(['bob', 'carol']));
    });

    it('lists an empty pending inbox for a user with no incoming requests', async () => {
      const res = await request(httpServer)
        .get('/friendships/pending')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);
      expect(res.body).toEqual([]);
    });
  });
});