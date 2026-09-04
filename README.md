# FriendMap

Real-time location sharing between friends, with privacy controls (Ghost / Everyone / Selected / Except-selected) and fast revocation when a user changes who can see them.

Built for a hiring task. Stack: NestJS (TypeScript, strict) · Prisma · PostgreSQL · Redis · Socket.IO · Vue 3 · Docker Compose.

## Setup

```bash
git clone https://github.com/Majdabbassi/FriendMap.git
cd FriendMap
docker compose up --build
```

- Web app: <http://localhost:8080>
- API: <http://localhost:3000>

5 demo users are seeded automatically on startup (reset on each boot; your own data is untouched).
Accounts: `alice`, `bob`, `carol`, `dave`, `erin` @ `friendmap.dev`, password `password123`.

To fully reset:

```bash
docker compose down -v && docker compose up --build
```

### Local dev without Docker

```bash
# apps/api
npm ci && npx prisma generate && npm run start:dev

# apps/web
npm ci && npm run dev
```

Copy `.env.example` to `.env` at the repo root first — only needed for this path, not for Docker.

## Architecture

```
            ┌──────────────┐
            │   Vue 3      │
            │ (Leaflet map)│
            └──────┬───────┘
                   │
            HTTP + Socket.IO
                   │
            ┌──────▼────────┐
            │   NestJS      │
            │               │
            │ Auth          │
            │ Friendships   │
            │ Sharing       │
            │ Location      │
            │  Gateway      │
            └───┬───────┬───┘
                │       │
         ┌──────▼──┐ ┌──▼──────┐
         │ Postgres│ │  Redis  │
         │ durable │ │  hot/   │
         │  data   │ │  live   │
         └─────────┘ └─────────┘
```

One NestJS app, organized into modules by domain (auth, friendships, sharing, location) rather than one flat folder. Postgres holds durable data (users, friendships, settings, sampled history). Redis holds hot/ephemeral state (current position, per-user history checkpoint) since GPS ticks every 5–15s don't need to hit a relational DB.

## Data model

- **User** — email, username, password hash
- **Friendship** — requester/addressee + status (PENDING/ACCEPTED). Rejecting deletes the row so a new request isn't blocked.
- **SharingSettings** — one per user, mode = GHOST/EVERYONE/SELECTED/EXCEPT\_SELECTED. Defaults to GHOST (fail-closed, invisible by default).
- **SharingListEntry** — owner/friend/listType (SELECTED or EXCEPT), independent of current mode.

Unfriending deletes the friendship and any list entries between that pair, in both directions.

## Real-time design

- Each user has a personal room (`user:{id}`) and a location-broadcast room (`location:{id}`) joined only by authorized viewers. No `server.emit()` to everyone.
- Visibility is checked on connect and re-checked on mode change, list change, and unfriend — both revoking viewers who lost access and granting ones who gained it, in under \~2s.
- Incoming GPS points are rejected if >30s in the future, >5min stale, out of order, or imply >500km/h since the last point.
- Client throttles to stay under the server's 5s rate limit per user.
- Location history: each accepted point is checked against a Redis checkpoint (kept if ≥30s or ≥25m since the last kept point) and written directly to Postgres with a 24h TTL. A 15-minute interval purges expired rows.

## Scaling to 100k users

Currently a single NestJS instance — Socket.IO state lives in process memory, so that's the first ceiling. Scaling out needs: Socket.IO's Redis adapter (for cross-instance delivery), and moving the in-memory rate limiter to Redis (the current `Map` won't work correctly across instances). Postgres load stays low regardless, since live positions stay in Redis and only sparse sampled points hit the DB.

## Trade-offs

- No Socket.IO Redis adapter — not needed for a single instance, would be required beyond one.
- JWT secret / DB credentials default in `docker-compose.yml` for zero-config startup — not production-safe as-is.
- No frontend tests — prioritized backend tests instead.

## Testing

```bash
cd apps/api
npm test
```

Covers visibility/authorization logic (all 4 modes), friendship duplicate-request handling, and location validation (stale/future/out-of-order/speed).

## Walkthrough

Watch the [Loom walkthrough](https://www.loom.com/share/9f81f4a086174129a44bb644c7677327) to see the app in action.
