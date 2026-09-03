export type StoredPoint = {
  lat: number;
  lng: number;
  timestamp: number;
};

type IncomingPoint = StoredPoint;

export function validateIncomingPoint(
  previous: StoredPoint | null,
  incoming: IncomingPoint,
): { valid: boolean; reason?: string } {
  const now = Date.now();
  if (incoming.timestamp - now > 30_000) {
    return { valid: false, reason: 'future-timestamp' };
  }
  if (now - incoming.timestamp > 5 * 60_000) {
    return { valid: false, reason: 'stale-timestamp' };
  }

  if (previous) {
    const timeDelta = incoming.timestamp - previous.timestamp;
    if (timeDelta <= 0) {
      return { valid: false, reason: 'out-of-order' };
    }

    const distanceKm = haversineKm(previous, incoming);
    const speedKmh = distanceKm / (timeDelta / 3_600_000);
    if (speedKmh > 500.000001) {
      return { valid: false, reason: 'implausible-speed' };
    }
  }

  return { valid: true };
}

export async function filterUnauthorizedViewers(
  viewerIds: string[],
  canView: (viewerId: string) => Promise<boolean>,
): Promise<string[]> {
  const results = await Promise.all(
    viewerIds.map(async (viewerId) => ({
      viewerId,
      allowed: await canView(viewerId),
    })),
  );
  return results.filter(({ allowed }) => !allowed).map(({ viewerId }) => viewerId);
}

export async function filterAuthorizedViewers(
  viewerIds: string[],
  canView: (viewerId: string) => Promise<boolean>,
): Promise<string[]> {
  const results = await Promise.all(
    viewerIds.map(async (viewerId) => ({
      viewerId,
      allowed: await canView(viewerId),
    })),
  );
  return results.filter(({ allowed }) => allowed).map(({ viewerId }) => viewerId);
}

function haversineKm(first: StoredPoint, second: StoredPoint) {
  const earthRadiusKm = 6371;
  const latDelta = toRadians(second.lat - first.lat);
  const lngDelta = toRadians(second.lng - first.lng);
  const firstLat = toRadians(first.lat);
  const secondLat = toRadians(second.lat);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(lngDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}