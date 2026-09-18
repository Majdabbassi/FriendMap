# FriendMap

Real-time location sharing between friends, with privacy controls (Ghost / Everyone / Selected / Except-selected) and fast revocation when a user changes who can see them.

Stack: NestJS (TypeScript, strict) · Prisma · PostgreSQL · Redis · Socket.IO · Vue 3 · Docker Compose · Kubernetes.

## 🎯 Features

### Core Functionality
- **Real-time Location Sharing**: Share your live location with friends via WebSocket
- **Privacy Controls**: Four sharing modes (Ghost, Everyone, Selected, Except-selected)
- **Fast Revocation**: Visibility changes take effect in under 2 seconds
- **Friendship Management**: Send, accept, reject, and remove friend requests
- **Location History**: View your own 24-hour location history
- **Location Validation**: Rejects stale, out-of-order, and implausible-speed points

### Production-Ready Features
- **Horizontal Scaling**: Kubernetes deployment with Socket.IO Redis adapter
- **Refresh Token Flow**: Secure JWT authentication with token rotation
- **Enhanced Security**: Helmet headers, rate limiting, non-root containers
- **Repository Pattern**: Clean data access layer with optimized queries
- **Health Monitoring**: Comprehensive health checks for all services
- **Batch Operations**: Eliminated N+1 queries for better performance

## 📸 Screenshots

| Description | Screenshot |
|---|---|
| Live map with friends' locations | ![Live map](docs/screenshots/map.png) |
| Sharing controls | ![Sharing controls](docs/screenshots/sharing.png) |
| Friends list | ![Friends list](docs/screenshots/friends.png) |

## 🚀 Quick Start

### Docker Compose (Development)
```bash
git clone https://github.com/Majdabbassi/FriendMap.git
cd FriendMap
cp .env.example .env
# Edit .env with your secure values
docker compose up --build
```

- Web app: <http://localhost:8080>
- API: <http://localhost:3000>
- API docs (Swagger): <http://localhost:3000/docs>
- Health check: <http://localhost:3000/health>

### Kubernetes (Production)
```bash
cd k8s
cp secrets.yaml.template secrets.yaml
# Edit secrets.yaml with your actual values
kubectl apply -f .
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions.

## 🔧 Setup & Configuration

### Environment Variables
```bash
# Database
POSTGRES_USER=friendmap
POSTGRES_PASSWORD=your-strong-password
POSTGRES_DB=friendmap

# JWT (generate with: openssl rand -base64 32)
JWT_SECRET=your-jwt-secret-min-32-characters

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Application
PORT=3000
NODE_ENV=development
VITE_API_URL=http://localhost:3000
```

### Demo Users
5 demo users are seeded automatically on startup:
- Accounts: `alice`, `bob`, `carol`, `dave`, `erin` @ `friendmap.dev`
- Password: `password123`

## 🏗️ Architecture

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
            │ Health        │
            └───┬───────┬───┘
                │       │
         ┌──────▼──┐ ┌──▼──────┐
         │ Postgres│ │  Redis  │
         │ durable │ │  hot/   │
         │  data   │ │  live   │
         └─────────┘ └─────────┘
```

### Module Structure
- **Auth**: JWT authentication, refresh tokens, user registration
- **Friendships**: Friend request management, status tracking
- **Sharing**: Privacy settings, visibility logic, list management
- **Location**: Real-time location updates, WebSocket gateway, history
- **Health**: Service health checks, monitoring endpoints
- **Throttling**: Distributed rate limiting via Redis

### Data Model
- **User**: email, username, password hash, refresh tokens
- **Friendship**: requester/addressee + status (PENDING/ACCEPTED)
- **SharingSettings**: mode = GHOST/EVERYONE/SELECTED/EXCEPT\_SELECTED
- **SharingListEntry**: owner/friend/listType (SELECTED or EXCEPT)
- **RefreshToken**: JWT refresh tokens with expiration
- **LocationHistoryPoint**: Sampled location history with 24-hour retention

## 📡 Real-time Design

- **Socket.IO Redis Adapter**: Enables horizontal scaling across multiple pods
- **Room-based Broadcasting**: Each user has personal rooms for targeted updates
- **Visibility Enforcement**: Checked on connect, mode change, list change, and unfriend
- **Rate Limiting**: Redis-based distributed rate limiting for location updates
- **Location Validation**: Rejects future (>30s), stale (>5min), out-of-order, and implausible-speed (>500km/h) points
- **History Sampling**: Stores points ≥30s or ≥25m apart, purged after 24 hours

## 🚀 Scaling to 100k Users

### Current Architecture Capacity
- **API Pods**: 3 replicas handling ~33k concurrent connections each
- **Redis**: Pub/sub for WebSocket communication, rate limiting
- **PostgreSQL**: Optimized with composite indexes for high throughput
- **Network**: ~12MB/second bandwidth requirement

### Bottlenecks & Mitigations
1. **Redis Single Point**: Implement Redis Cluster for >150k users
2. **Database Connections**: Add PgBouncer for connection pooling
3. **WebSocket Memory**: Scale pods or increase memory allocation
4. **History Writes**: Implement time-series partitioning for >200k users

See [SCALING_ANALYSIS.md](SCALING_ANALYSIS.md) for detailed capacity planning.

## 🔒 Security Features

- **Refresh Token Flow**: Short-lived access tokens (15min) + long-lived refresh tokens (7 days)
- **Helmet Integration**: Security headers for all HTTP responses
- **Enhanced Rate Limiting**: 3 requests/minute for auth endpoints
- **Non-root Containers**: All containers run as non-root users
- **Required Secrets**: No insecure defaults, all credentials externalized
- **Authorization Enforcement**: Checked on HTTP, WebSocket, and history reads

## 🧪 Testing

Both workspaces ship with Vitest (web) and Jest (API) unit tests, plus a real end-to-end suite.

```bash
# API unit tests + lint
cd apps/api
npm test
npm run lint

# API end-to-end tests (requires Postgres + Redis, see docker-compose.yml)
npm run test:e2e

# Web unit tests
cd ../web
npm run test:unit
```

E2E coverage (runs against the seeded demo users):
- Full auth flow: register → login → refresh-token rotation → logout revocation
- Friendship access control (authenticated lists, empty pending inbox)
- Socket.IO: rejected connections, location broadcast between friends, stop/resume viewing

Unit coverage:
- Auth service, refresh token rotation
- Visibility/authorization logic (all 4 sharing modes)
- Friendship request handling (duplicates, status transitions)
- Location validation (stale/future/out-of-order/implausible speed)
- WebSocket gateway (connection, rate limiting, privacy events)
- Web: API client token handling + Pinia auth store
- API docs at <http://localhost:3000/docs> (Swagger UI)

## 📚 Documentation

- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) - Comprehensive implementation details
- [SCALING_ANALYSIS.md](SCALING_ANALYSIS.md) - Capacity planning and bottlenecks
- [DEPLOYMENT.md](DEPLOYMENT.md) - Complete deployment guide
- [k8s/README.md](k8s/README.md) - Kubernetes deployment instructions

## 🔄 Trade-offs

### Implemented Solutions
- ✅ Socket.IO Redis adapter for horizontal scaling
- ✅ Redis-based distributed rate limiting
- ✅ Complete refresh token flow
- ✅ Repository pattern for clean data access
- ✅ Kubernetes manifests for production deployment
- ✅ Enhanced security (Helmet, rate limiting, non-root containers)
- ✅ Batch operations to eliminate N+1 queries
- ✅ Health monitoring and observability

### Remaining Enhancements
- Metrics collection (Prometheus integration planned)
- Distributed tracing (Jaeger integration planned)
- Redis clustering (for >150k users)

## 🎓 Implementation Approach

Built from the ground up around privacy-first real-time sharing: the API enforces visibility at every boundary (HTTP, WebSocket, and history reads), Redis powers horizontally-scalable socket broadcast and distributed rate limiting, and the Vue client keeps a 2-second revocation target for sharing-mode changes. The repo is organized around clear module boundaries (auth, friendships, sharing, location, health) with thin controllers, strict TypeScript, and tests at every layer.

- Strict TypeScript throughout, thin controllers, repository pattern for data access
- Kubernetes-ready: Socket.IO Redis adapter, health checks, non-root containers
- Distributed rate limiting via Redis, batch queries to eliminate N+1

## 📞 Support

For issues or questions:
- Check the [troubleshooting section](DEPLOYMENT.md#troubleshooting)
- Review the [scaling analysis](SCALING_ANALYSIS.md) for performance issues
- Open an issue on GitHub for bugs

## 🎥 Walkthrough

Watch the [Loom walkthrough](https://www.loom.com/share/9f81f4a086174129a44bb644c7677327) to see the app in action.
