# FriendMap Deployment Guide

This guide covers deploying FriendMap in both development (Docker Compose) and production (Kubernetes) environments.

## Prerequisites

### Development (Docker Compose)
- Docker Desktop or Docker Engine
- Docker Compose v2.0+
- At least 4GB RAM available
- At least 10GB disk space

### Production (Kubernetes)
- Kubernetes cluster (v1.24+)
- kubectl configured
- Container registry access
- At least 8GB RAM for cluster
- At least 20GB disk space

## Development Deployment

### 1. Environment Setup
```bash
# Clone the repository
git clone <your-repo-url>
cd FriendMap

# Copy environment template
cp .env.example .env

# Edit .env with your values
# Use openssl to generate secure secrets:
# openssl rand -base64 32
```

### 2. Required Environment Variables
```bash
# Database
POSTGRES_USER=friendmap
POSTGRES_PASSWORD=your-strong-password
POSTGRES_DB=friendmap

# JWT
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

### 3. Build and Start
```bash
# Build and start all services
docker compose up --build

# Access the application
# Web: http://localhost:8080
# API: http://localhost:3000
```

### 4. Verify Deployment
```bash
# Check all services are running
docker compose ps

# Check logs
docker compose logs -f api
docker compose logs -f web

# Test health endpoint
curl http://localhost:3000/health
```

### 5. Development Workflow
```bash
# Rebuild specific service
docker compose up --build api

# View logs for specific service
docker compose logs -f api

# Stop all services
docker compose down

# Stop and remove volumes (full reset)
docker compose down -v
```

## Production Deployment (Kubernetes)

### 1. Build Docker Images
```bash
# Build API image
cd apps/api
docker build -t your-registry/friendmap-api:latest .

# Build Web image
cd ../web
docker build -t your-registry/friendmap-web:latest .

# Push to registry
docker push your-registry/friendmap-api:latest
docker push your-registry/friendmap-web:latest
```

### 2. Configure Kubernetes Secrets
```bash
cd k8s

# Copy secrets template
cp secrets.yaml.template secrets.yaml

# Edit secrets.yaml with actual values
# Generate secure secrets using:
# openssl rand -base64 32
```

### 3. Update Image References
Edit `api-deployment.yaml` and `web-deployment.yaml` to use your registry:
```yaml
# api-deployment.yaml
image: your-registry/friendmap-api:latest

# web-deployment.yaml
image: your-registry/friendmap-web:latest
```

### 4. Deploy to Kubernetes
```bash
# Apply configuration
kubectl apply -f configmap.yaml
kubectl apply -f secrets.yaml

# Deploy storage
kubectl apply -f postgres-pvc.yaml
kubectl apply -f redis-pvc.yaml

# Deploy database
kubectl apply -f postgres-deployment.yaml
kubectl apply -f postgres-service.yaml

# Deploy Redis
kubectl apply -f redis-deployment.yaml
kubectl apply -f redis-service.yaml

# Deploy application
kubectl apply -f api-deployment.yaml
kubectl apply -f api-service.yaml
kubectl apply -f web-deployment.yaml
kubectl apply -f web-service.yaml

# Deploy ingress
kubectl apply -f ingress.yaml
```

### 5. Verify Deployment
```bash
# Check pod status
kubectl get pods

# Check services
kubectl get services

# Check ingress
kubectl get ingress

# View logs
kubectl logs -f deployment/api
kubectl logs -f deployment/web

# Test health endpoint
kubectl port-forward service/api-service 3000:3000
curl http://localhost:3000/health
```

### 6. Access the Application
```bash
# If using LoadBalancer service
kubectl get service web-service

# If using ingress
# Add ingress IP to /etc/hosts
echo "<ingress-ip> friendmap.local" | sudo tee -a /etc/hosts
# Access at http://friendmap.local
```

## Scaling

### Docker Compose Scaling
```bash
# Scale API service
docker compose up --scale api=3

# Scale Web service
docker compose up --scale web=2
```

### Kubernetes Scaling
```bash
# Scale API deployment
kubectl scale deployment api --replicas=5

# Scale Web deployment
kubectl scale deployment web --replicas=3

# Enable autoscaling
kubectl autoscale deployment api --min=3 --max=10 --cpu-percent=70
```

## Monitoring

### Health Checks
```bash
# Docker Compose
curl http://localhost:3000/health

# Kubernetes
kubectl port-forward service/api-service 3000:3000
curl http://localhost:3000/health
```

### Logs
```bash
# Docker Compose
docker compose logs -f api
docker compose logs -f web

# Kubernetes
kubectl logs -f deployment/api
kubectl logs -f deployment/web
```

### Metrics (Future)
- Consider Prometheus + Grafana
- Consider Jaeger for distributed tracing
- Consider ELK stack for log aggregation

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed
**Symptoms**: API crashes with database connection error
**Solution**: 
- Check PostgreSQL is running: `docker compose ps postgres`
- Verify DATABASE_URL in .env
- Check PostgreSQL logs: `docker compose logs postgres`

#### 2. Redis Connection Failed
**Symptoms**: WebSocket connections fail, rate limiting errors
**Solution**:
- Check Redis is running: `docker compose ps redis`
- Verify REDIS_HOST and REDIS_PORT
- Check Redis logs: `docker compose logs redis`

#### 3. Pods Not Starting (Kubernetes)
**Symptoms**: Pods stuck in Pending or CrashLoopBackOff
**Solution**:
- Check pod status: `kubectl describe pod <pod-name>`
- Check pod logs: `kubectl logs <pod-name>`
- Verify secrets are applied: `kubectl get secrets`
- Check resource limits

#### 4. Ingress Not Working
**Symptoms**: Cannot access application via ingress
**Solution**:
- Check ingress controller is installed
- Verify ingress resource: `kubectl get ingress`
- Check ingress logs: `kubectl logs -n ingress-nginx deployment/ingress-nginx-controller`

#### 5. Rate Limiting Too Aggressive
**Symptoms**: Legitimate requests being blocked
**Solution**:
- Adjust rate limits in app.module.ts
- Check Redis rate limiting configuration
- Monitor rate limiting metrics

## Backup and Recovery

### Database Backup
```bash
# Docker Compose
docker compose exec postgres pg_dump -U friendmap friendmap > backup.sql

# Kubernetes
kubectl exec deployment/postgres -- pg_dump -U friendmap friendmap > backup.sql
```

### Database Restore
```bash
# Docker Compose
docker compose exec -T postgres psql -U friendmap friendmap < backup.sql

# Kubernetes
kubectl exec -i deployment/postgres -- psql -U friendmap friendmap < backup.sql
```

### Redis Backup
```bash
# Docker Compose
docker compose exec redis redis-cli -a password SAVE
docker compose cp postgres:/data/dump.rdb ./redis-backup.rdb

# Kubernetes
kubectl exec deployment/redis -- redis-cli -a password SAVE
kubectl cp deployment/redis:/data/dump.rdb ./redis-backup.rdb
```

## Security Considerations

### Production Checklist
- [ ] Change all default passwords
- [ ] Use strong JWT secrets (32+ characters)
- [ ] Enable HTTPS/TLS for production
- [ ] Configure network policies
- [ ] Use secrets management (AWS Secrets Manager, etc.)
- [ ] Enable audit logging
- [ ] Configure resource quotas
- [ ] Enable pod security policies
- [ ] Regular security updates
- [ ] Monitor for security incidents

### TLS/SSL Configuration
```bash
# For production, configure TLS termination
# Option 1: Load balancer TLS termination
# Option 2: Ingress TLS termination
# Option 3: Application TLS termination
```

## Cost Optimization

### Resource Optimization
- Use burstable instances for development
- Implement horizontal pod autoscaling
- Use spot instances for non-critical workloads
- Implement resource quotas and limits
- Regular cleanup of unused resources

### Cost Monitoring
- Set up cost alerts
- Monitor resource utilization
- Implement rightsizing recommendations
- Use reserved instances for predictable workloads

## Rollback Procedures

### Docker Compose Rollback
```bash
# Stop current deployment
docker compose down

# Checkout previous version
git checkout <previous-commit>

# Rebuild and start
docker compose up --build
```

### Kubernetes Rollback
```bash
# Check deployment history
kubectl rollout history deployment/api

# Rollback to previous version
kubectl rollout undo deployment/api

# Rollback to specific revision
kubectl rollout undo deployment/api --to-revision=<revision-number>
```

## Maintenance

### Database Maintenance
```bash
# Run Prisma migrations
npx prisma migrate deploy

# Seed database (development only)
npx prisma db seed

# Clean up expired refresh tokens
# Implement scheduled job in production
```

### Redis Maintenance
```bash
# Monitor Redis memory usage
docker compose exec redis redis-cli INFO memory

# Clean up expired keys
docker compose exec redis redis-cli --scan --pattern "rate-limit:*" | xargs redis-cli DEL
```

## Support

For issues or questions:
- Check the troubleshooting section
- Review logs for error messages
- Consult the scaling analysis for performance issues
- Open an issue on GitHub for bugs

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Socket.IO Documentation](https://socket.io/docs/)
