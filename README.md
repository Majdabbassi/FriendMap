# FriendMap

A real-time location-sharing app: authenticated users share their live position with a chosen subset of friends, with privacy-first sharing controls and near-instant revocation when access is changed.

Built for a hiring task. Stack: NestJS (TypeScript, strict) · Prisma · PostgreSQL · Redis · Socket.IO · Vue 3 · Docker Compose.

## Setup

Requires Docker and Docker Compose. No other setup needed.

```bash
git clone https://github.com/Majdabbassi/FriendMap.git
cd FriendMap
docker compose up --build
```

This brings up Postgres, Redis, the API, and the web client, synchronizes the Prisma schema automatically, and works with **zero configuration** — every environment variable has a sensible default baked into `docker-compose.yml`.

Once running:
- Web app: http://localhost:8080
- API: http://localhost:3000

To seed 5 demo users with a realistic friend graph and all four sharing modes represented:
```bash
cd apps/api
npx prisma db seed
```
(Demo accounts: `alice`, `bob`, `carol`, `dave`, `erin` @ `friendmap.dev`, password `password123` for all — see seed script for the full relationship/settings map.)

### Local development (without Docker)
Each app can also run locally against the Dockerized Postgres/Redis (their ports are exposed to the host):
```bash
# apps/api
npm ci
npx prisma generate
npm run start:dev

# apps/web
npm ci
npm run dev
```
Both read a single shared `.env` at the repo root (copy `.env.example` to get started) — this is the one difference from the Docker path, since NestJS's `ConfigModule` and Vite each need an explicit env source when running outside Compose.

## Architecture

                ┌──────────────┐
                │   Vue 3      │
                │ (Leaflet map)│
                └──────┬───────┘
                       │
             HTTP + Socket.IO
                       │
                ┌──────▼───────┐
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


Organized as a **feature-based modular monolith** — one NestJS application, one deployment unit, but internally split into independent modules (`auth`, `friendships`, `sharing`, `location`) rather than one flat folder of controllers/services. This isn't microservices; it's just organizing by domain instead of by technical layer, which NestJS's module system is built around. Chosen because the task has clearly separable responsibilities, it keeps the authorization logic (the part that's most important to get right) isolated and independently testable, and it doesn't add the operational overhead microservices would for a 7-day solo project.

**Why Postgres vs Redis:** Postgres holds permanent truth — users, friendships, sharing settings, list entries, and the sampled location-history trail (with a row-level 24h TTL). Redis holds only hot, ephemeral, constantly-changing state — each user's current position (with a 24h TTL) plus the per-user history checkpoint — because writing every 5-15-second GPS tick to a relational database at scale is unnecessary load for data that's replaced within seconds anyway; only the much sparser sampled points land in Postgres.

## Data model

- **User** — email, username, password hash.
- **Friendship** — `requesterId`, `addresseeId`, `status` (PENDING/ACCEPTED). A friendship is only usable for sharing once ACCEPTED. Rejecting deletes the row entirely (as if the request never happened), so a new request afterward isn't blocked by the unique constraint on the requester/addressee pair.
- **SharingSettings** — one row per user, holds their current mode (`GHOST` | `EVERYONE` | `SELECTED` | `EXCEPT_SELECTED`). Defaults to `GHOST` — an unconfigured user is invisible by default, not visible by default; privacy-by-default was a deliberate choice over the spec's literal default framing.
- **SharingListEntry** — `ownerId`, `friendId`, `listType` (`SELECTED` | `EXCEPT`). Both lists persist independently of which mode is currently active — switching modes back and forth never loses a previously-built list, the same way Instagram's "close friends" list survives even when you're not using it.

Unfriending cascades: it deletes the `Friendship` row and any `SharingListEntry` rows between that pair in either direction, so no orphaned list entries point at an ex-friend.

## Real-time design

- Each user has a personal Socket.IO room (`user:{userId}`, joined on connect) and a location-broadcast room (`location:{userId}`, joined only by currently-authorized viewers).
- Nothing is ever sent via `server.emit()` to everyone — every location update, snapshot, and hide event is scoped to a specific room or specific socket. No broadcast-to-all, by construction, not just convention.
- **Authorization is checked at connection time (`view:friends`) and re-checked live** on three events: sharing mode change, sharing list change, and friend removal. When any of these fire, the gateway both revokes viewers who are no longer authorized (leaves the room, emits `location:hidden`) **and** grants newly-authorized viewers (joins the room, pushes a snapshot) — so visibility changes propagate to currently-connected clients within ~2 seconds in both directions, exceeding the spec's requirement (which only asks for the revoke case).
- Incoming GPS points are validated before being trusted: rejected if timestamped >30s in the future, >5min stale, out of order versus the user's last known point, or implying >500km/h ground speed since the last point (a user's very first-ever point has nothing to compare against, so it's accepted unconditionally).
- The client throttles its own emit rate to stay under the server's 5-second-per-update rate limit.
- **Location history** is a lightweight direct-write design: each accepted point is checked against a per-user Redis checkpoint (a point is kept only if it's ≥30s later or ≥25m from the last kept one), and a sampled point is written straight to the `LocationHistoryPoint` table in Postgres with a 24h TTL. A 15-minute `setInterval` purges expired rows. The served "My history" trail reads from Postgres via `GET /location/history`. No Redis queue, worker, or flush lock is involved.

## Scaling notes (target: 100,000 concurrent users)

The current design is a **single NestJS instance**. At that scale, the first thing to break is Socket.IO itself: all connected sockets live in one process's memory, so this instance is both a single point of failure and a hard ceiling on connection count.

The fix is horizontal scaling behind a load balancer with sticky sessions (or a Socket.IO-aware LB), with multiple NestJS instances sharing state via:
- **Redis** already holds current-location state, so it's already positioned to be the shared source of truth across instances rather than per-instance memory.
- **Socket.IO's Redis adapter** (not implemented here, deliberately — see trade-offs) would be required so that an event generated on instance A (e.g. a location update) correctly reaches a socket connected to instance B. Without it, cross-instance delivery silently fails the moment you run more than one API replica.

Second bottleneck: Postgres connection pooling under write volume — mitigated by the fact that live location updates stay entirely in Redis; Postgres only sees the relatively rare friend-request/sharing-settings changes plus the sparsely sampled history points (at most ~one write per user per 30s/25m).

Third: the naive per-instance in-memory rate limiter (`Map<userId, timestamp>` in the gateway) would not work correctly across multiple instances, since a user's requests could land on different instances between calls — this would need to move to Redis-backed rate limiting (e.g. a sliding window in Redis) for correctness at scale.

## Trade-offs made

- **Redis Pub/Sub / Socket.IO Redis adapter not implemented** — correctly unnecessary for a single-instance deployment; would be required the moment this runs on more than one instance (see Scaling notes).
- **CORS allowlist is a hardcoded array of known local/Docker origins**, not an env-driven allowlist. Fine for this local/demo scope; would need to be configurable for a real deployment.
- **Default JWT secret and DB credentials are baked into `docker-compose.yml`** so the stack runs with zero setup from a clean clone. This is intentionally insecure for convenience — a production deployment would need these to be required, not defaulted.
- **Prisma 7's driver-adapter requirement** (a breaking change from earlier Prisma versions) meant `PrismaService` needs an explicit `PrismaPg` adapter passed to its constructor rather than a bare `extends PrismaClient` — a version-specific detail worth knowing since it silently breaks at runtime, not at type-check time, if missed.
- **No frontend tests** — time was prioritized on the backend's authorization logic (the part explicitly required to be tested) and on manually verifying the real-time behavior end-to-end across multiple browser sessions, rather than on frontend test coverage.
- **Marker clustering and live visibility-gain updates** (not just revocation) were added beyond the spec's literal requirements, since both were low-effort extensions of infrastructure already built for the required features.

## Testing

```bash
cd apps/api
npm test
```

Unit tests cover the visibility/authorization logic (`VisibilityService`, all 4 sharing modes, friendship gating, default-mode fallback), friendship duplicate-request detection, and location point validation (stale/future/out-of-order/speed rejection).

## Walkthrough

[Loom link here]