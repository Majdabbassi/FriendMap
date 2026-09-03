import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'ts-node --esm prisma/seed.ts',
  },
});
