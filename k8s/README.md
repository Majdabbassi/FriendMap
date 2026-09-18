# FriendMap Kubernetes Deployment

This directory contains Kubernetes manifests for deploying FriendMap to a Kubernetes cluster.

## Prerequisites

- Kubernetes cluster (minikube, kind, or cloud provider)
- kubectl configured to connect to your cluster
- Docker images built and pushed to a registry

## Setup

1. **Configure Secrets**:
   ```bash
   cp secrets.yaml.template secrets.yaml
   # Edit secrets.yaml with your actual values
   ```

2. **Build and Push Docker Images**:
   ```bash
   # Build API image
   docker build -t friendmap-api:latest ./apps/api
   # Build Web image
   docker build -t friendmap-web:latest ./apps/web
   
   # Push to your registry (replace with your registry)
   docker tag friendmap-api:latest your-registry/friendmap-api:latest
   docker tag friendmap-web:latest your-registry/friendmap-web:latest
   docker push your-registry/friendmap-api:latest
   docker push your-registry/friendmap-web:latest
   ```

3. **Update Image References**:
   Update the image references in `api-deployment.yaml` and `web-deployment.yaml` to use your registry.

4. **Deploy to Kubernetes**:
   ```bash
   # Apply all manifests
   kubectl apply -f configmap.yaml
   kubectl apply -f secrets.yaml
   kubectl apply -f postgres-pvc.yaml
   kubectl apply -f redis-pvc.yaml
   kubectl apply -f postgres-deployment.yaml
   kubectl apply -f postgres-service.yaml
   kubectl apply -f redis-deployment.yaml
   kubectl apply -f redis-service.yaml
   kubectl apply -f api-deployment.yaml
   kubectl apply -f api-service.yaml
   kubectl apply -f web-deployment.yaml
   kubectl apply -f web-service.yaml
   kubectl apply -f ingress.yaml
   ```

5. **Access the Application**:
   - If using minikube: `minikube service web-service`
   - If using ingress: Add `friendmap.local` to your `/etc/hosts` file pointing to the ingress controller IP

## Scaling

The deployment is configured with:
- API: 3 replicas
- Web: 2 replicas
- PostgreSQL: 1 replica (stateful)
- Redis: 1 replica (stateful)

To scale the API or web deployments:
```bash
kubectl scale deployment api --replicas=5
kubectl scale deployment web --replicas=3
```

## Monitoring

Check pod status:
```bash
kubectl get pods
kubectl logs -f deployment/api
kubectl logs -f deployment/web
```

## Cleanup

```bash
kubectl delete -f .
```
