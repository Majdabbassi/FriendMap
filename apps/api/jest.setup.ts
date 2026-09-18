import { jest } from '@jest/globals';

Object.assign(globalThis, { jest });

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-that-is-at-least-32-chars-long';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/friendmap_test';
process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? 'test-redis-password';