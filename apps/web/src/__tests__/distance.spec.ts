import { describe, it, expect } from 'vitest'
import { formatDistanceKm, haversineKm } from '../utils/distance'

describe('haversineKm', () => {
  it('returns ~0 for identical coordinates', () => {
    expect(haversineKm(36.8, 10.18, 36.8, 10.18)).toBeCloseTo(0, 8)
  })

  it('computes a realistic Tunis–Sfax distance', () => {
    const km = haversineKm(36.8, 10.18, 34.74, 10.76)
    expect(km).toBeGreaterThan(230)
    expect(km).toBeLessThan(250)
  })

  it('is symmetric', () => {
    const a = haversineKm(35.0, 9.0, 33.0, 11.0)
    const b = haversineKm(33.0, 11.0, 35.0, 9.0)
    expect(a).toBeCloseTo(b, 6)
  })
})

describe('formatDistanceKm', () => {
  it('formats meters under 1 km', () => {
    expect(formatDistanceKm(0)).toBe('0 m')
    expect(formatDistanceKm(0.42)).toBe('420 m')
  })

  it('formats tenths between 1 and 10 km', () => {
    expect(formatDistanceKm(2.67)).toBe('2.7 km')
  })

  it('rounds above 10 km', () => {
    expect(formatDistanceKm(12.4)).toBe('12 km')
    expect(formatDistanceKm(48.6)).toBe('49 km')
  })
})