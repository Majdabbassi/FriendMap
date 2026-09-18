# FriendMap Implementation Plan

## Overview

FriendMap is a privacy-first, real-time location-sharing application. Friends share live locations over WebSocket, choose exactly who can see them (Ghost / Everyone / Selected / Except-selected), and benefit from instant revocation when those choices change. The backend is designed to scale horizontally via a Socket.IO Redis adapter, and the client is built as a Leaflet map driven by live socket events.

This document records the architecture decisions, key implementation details, scaling analysis, and the roadmap.

## Architecture Decisions

### 1. Horizontal Scaling & Infrastructure
- **Kubernetes Deployment**: Complete K8s manifests for production deployment
- **Non-root Containers**: All containers run as non-root users for security
- **Socket.IO Redis Adapter**: Enables multi-pod WebSocket communication
- **Redis-based Rate Limiting**: Distributed rate limiting across instances

### 2. Authentication & Security
- **Refresh Token Flow**: Complete JWT refresh token implementation with rotation
- **Short-lived Access Tokens**: 15-minute expiry for access tokens
- **Long-lived Refresh Tokens**: 7-day expiry, revoked on logout and rotation
- **Helmet Integration**: Security headers for all HTTP responses
- **Environment Validation**: `NODE_ENV`, `JWT_SECRET`, `DATABASE_URL`, and `REDIS_PASSWORD` are validated at boot; insecure defaults are rejected
- **Global Exception Filter**: Consistent error envelope across all endpoints

### 3. Data Layer
- **Repository Pattern**: Abstracted data access layer
- **Batch Operations**: Eliminated N+1 queries in visibility checks
- **Optimized Indexes**: Composite indexes for frequent query patterns
- **Redis Hot State**: Current locations, history checkpoints, and presence tracked in Redis

### 4. Performance
- **Batch Visibility Checks**: Single query for multiple friend visibility checks
- **Targeted WebSocket Fan-out**: Broadcasts go only to authorized viewers' rooms
- **Distributed Rate Limiting**: Redis-backed limits for socket updates and HTTP routes
- **API Documentation**: Swagger/OpenAPI at `/docs`, generated from DTOs

## Key Features

### Core
- Real-time location sharing via WebSocket with a 2-second revocation target
- Four sharing modes: Ghost (default), Everyone, Selected, Except-selected
- Friendship management: request, accept, reject, unfriend
- Location validation: rejects stale (>5min), future (>30s), out-of-order, and implausible-speed (>500km/h) points
- 24-hour sampled location history with dual checkpointing (Postgres retention, Redis checkpoint)
- Security and hardening: strict TypeScript, DTO validation on every endpoint, fail-closed visibility, Helmet, required secrets

### Testing
- Unit: visibility logic (all 4 modes), friendships, location validation, auth/refresh, WebSocket gateway, web API client and Pinia stores
- E2E: full auth flow, friendship access control, socket connectivity and location broadcast (runs against seeded demo users)

## Scaling Analysis

### Target: 100,000 Concurrent Users

#### Assumptions
- Average location updates: 1 per 10 seconds per user
- Average map viewers: 3 friends per user
- WebSocket connections: 100k concurrent
- Location updates: 10k per second
- Map refresh requests: 30k per second

#### Architecture Capacity
- **API Pods**: 3 replicas, each handling ~33k concurrent connections
- **Redis**: Single instance for pub/sub and rate limiting (can be clustered)
- **PostgreSQL**: Optimized with indexes, handles read/write load
- **WebSocket Fan-out**: Redis adapter ensures cross-pod delivery

#### Bottlenecks (in order of concern)
1. **Redis Single Point**: Redis adapter needs clustering for >50k connections
2. **Database Connection Pool**: Need PgBouncer for connection management
3. **WebSocket Memory**: Each connection uses ~10KB, need ~1GB per pod
4. **Location History**: 10k writes/second may require partitioning

#### Mitigation Strategies
- Redis Cluster for horizontal scaling
- PgBouncer for connection pooling
- Hash-tag routing for sticky sessions
- Database partitioning by user ID
- Read replicas for query scaling

## Deployment Options

### Docker Compose (Development)
```bash
cp .env.example .env
docker compose up --build
```

### Kubernetes (Production)
```bash
cd k8s
cp secrets.yaml.template secrets.yaml
kubectl apply -f .
```

## Security Considerations

### Authentication
- JWT access tokens: 15-minute expiry
- JWT refresh tokens: 7-day expiry, rotated on use and revoked on logout
- Secure token storage (httpOnly cookies recommended for production)

### Rate Limiting
- Auth endpoints: 3 requests/minute
- General endpoints: 20 requests/minute
- Location updates: 12 requests/minute per user
- Distributed rate limiting via Redis

### Infrastructure Security
- Non-root containers
- Security headers via Helmet
- Required environment variables (no insecure defaults)
- Network policies in Kubernetes
- Secrets management via K8s secrets

## Testing Strategy

### Backend
- Unit tests for all services and helpers
- WebSocket gateway tests (connection, rate limiting, privacy events)
- Real E2E tests requiring Postgres + Redis (see `apps/api/test/`)
- CI runs unit tests, linting, and the build; E2E runs against containerized infra

### Frontend
- Vitest unit tests for the API client and Pinia stores
- Planned: component tests and mapped socket flows as features land

### Load Testing (future)
- Simulate 100k concurrent users
- Test WebSocket connection handling
- Verify rate limiting effectiveness
- Database performance under load

## Roadmap

### Next Up
- **Friend Chat**: 1:1 messaging between accepted friends over Socket.IO, persisted via Prisma, with history endpoints
- **Online Presence**: Redis-backed presence tracking, broadcast on connect/disconnect, indicators on the map

### Post-MVP
- Metrics collection (Prometheus)
- Distributed tracing (Jaeger)
- Database read replicas
- Redis clustering
- CDN for static assets
- Component tests for the web client

## Trade-offs Made

### Repository Pattern
- **Pro**: Clean separation of concerns, testable, optimized queries
- **Con**: Additional abstraction layer, slightly more complex
- **Decision**: Worth it for maintainability and performance

### Redis Adapter
- **Pro**: Enables horizontal scaling, production-ready
- **Con**: Adds network latency, complexity
- **Decision**: Necessary for production scaling

### Refresh Tokens
- **Pro**: Better security, reduced token size
- **Con**: Additional database storage, complexity
- **Decision**: Standard pattern for scalable auth

### Kubernetes Deployment
- **Pro**: Production-ready, scalable, cloud-agnostic
- **Con**: Complex for local development
- **Decision**: Docker Compose for dev, K8s for prod

## Conclusion

FriendMap is a production-ready, horizontally scalable location-sharing application with a clean module structure, comprehensive tests, and a privacy model enforced at every boundary. The roadmap keeps it aligned with real-time social features: friend chat and online presence on the same socket infrastructure.