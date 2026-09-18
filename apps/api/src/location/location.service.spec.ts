import {
  filterAuthorizedViewers,
  filterUnauthorizedViewers,
  validateIncomingPoint,
} from './location.service';

describe('location validation', () => {
  const now = 1_700_000_000_000;
  const point = { lat: 0, lng: 0, timestamp: now - 60_000 };

  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now));
  afterEach(() => jest.restoreAllMocks());

  it('accepts a first-ever point', () => {
    expect(validateIncomingPoint(null, point)).toEqual({ valid: true });
  });

  it('accepts a valid sequential point', () => {
    expect(
      validateIncomingPoint(point, { lat: 0, lng: 0.01, timestamp: now }),
    ).toEqual({ valid: true });
  });

  it('rejects an out-of-order timestamp', () => {
    expect(validateIncomingPoint(point, { ...point, timestamp: now - 60_001 })).toEqual({
      valid: false,
      reason: 'out-of-order',
    });
  });

  it('rejects a future timestamp', () => {
    expect(validateIncomingPoint(null, { ...point, timestamp: now + 30_001 })).toEqual({
      valid: false,
      reason: 'future-timestamp',
    });
  });

  it('rejects a stale timestamp', () => {
    expect(validateIncomingPoint(null, { ...point, timestamp: now - 300_001 })).toEqual({
      valid: false,
      reason: 'stale-timestamp',
    });
  });

  it('rejects speeds over 500 km/h', () => {
    expect(
      validateIncomingPoint(point, { lat: 1, lng: 0, timestamp: now }),
    ).toEqual({ valid: false, reason: 'implausible-speed' });
  });

  it('accepts exactly 500 km/h', () => {
    const distanceAt500Kmh = 500;
    const latitude = distanceAt500Kmh / (2 * Math.PI * 6371 / 360);
    expect(
      validateIncomingPoint(
        { ...point, timestamp: now - 60 * 60_000 },
        {
        lat: latitude,
        lng: 0,
        timestamp: now,
        },
      ),
    ).toEqual({ valid: true });
  });
});

describe('filterUnauthorizedViewers', () => {
  it('returns only viewers that can no longer view', async () => {
    await expect(
      filterUnauthorizedViewers(['allowed', 'blocked'], async (viewerId) =>
        viewerId === 'allowed',
      ),
    ).resolves.toEqual(['blocked']);
  });
});

describe('filterAuthorizedViewers', () => {
  it('returns only viewers that can now view', async () => {
    await expect(
      filterAuthorizedViewers(['allowed', 'blocked'], async (viewerId) =>
        viewerId === 'allowed',
      ),
    ).resolves.toEqual(['allowed']);
  });
});