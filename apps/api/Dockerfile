FROM node:24.12-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY prisma.config.ts nest-cli.json tsconfig*.json ./
COPY prisma ./prisma
COPY src ./src
RUN DATABASE_URL=postgresql://friendmap:friendmap@localhost:5432/friendmap npx prisma generate
RUN npm run build

FROM node:24.12-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]