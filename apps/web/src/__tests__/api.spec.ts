import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  apiBaseUrl,
  apiRequest,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAuthFailureHandler,
  setTokens,
} from '../api'

describe('api.ts', () => {
  beforeEach(() => {
    localStorage.clear()
    setAuthFailureHandler(null)
    vi.unstubAllGlobals()
  })

  describe('token storage', () => {
    it('round-trips access and refresh tokens through localStorage', () => {
      expect(getAccessToken()).toBeNull()
      expect(getRefreshToken()).toBeNull()

      setTokens({ access_token: 'access', refresh_token: 'refresh' })

      expect(getAccessToken()).toBe('access')
      expect(getRefreshToken()).toBe('refresh')

      clearTokens()
      expect(getAccessToken()).toBeNull()
      expect(getRefreshToken()).toBeNull()
    })
  })

  describe('apiRequest', () => {
    it('sends the bearer token and parses the JSON response', async () => {
      setTokens({ access_token: 'access-token', refresh_token: 'refresh-token' })

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'user-1' }),
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await apiRequest<{ id: string }>('/friends')

      expect(fetchMock).toHaveBeenCalledWith(
        `${apiBaseUrl}/friends`,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        }),
      )
      expect(result).toEqual({ id: 'user-1' })
    })

    it('throws a descriptive error when the request fails', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'Bad request' }),
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(apiRequest('/friends')).rejects.toThrow('Bad request')
    })

    it('refreshes the access token and retries the original request on a 401', async () => {
      setTokens({ access_token: 'old-access', refresh_token: 'refresh-token' })

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401, text: async () => '{}' })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-access',
            refresh_token: 'new-refresh',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true }),
        })
      vi.stubGlobal('fetch', fetchMock)

      const result = await apiRequest<{ ok: boolean }>('/friends')

      expect(result).toEqual({ ok: true })
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('refresh-token')
      expect(getAccessToken()).toBe('new-access')
      expect(
        (fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>).Authorization,
      ).toBe('Bearer new-access')
    })

    it('does not retry when there is no refresh token stored', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '{}' })
      vi.stubGlobal('fetch', fetchMock)

      await expect(apiRequest('/friends')).rejects.toThrow()

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('invalidates the session and notifies the failure handler when refresh fails', async () => {
      setTokens({ access_token: 'old-access', refresh_token: 'refresh-token' })
      const onAuthFailure = vi.fn()
      setAuthFailureHandler(onAuthFailure)

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401, text: async () => '{}' })
        .mockResolvedValueOnce({ ok: false, status: 401, text: async () => '{}' })
      vi.stubGlobal('fetch', fetchMock)

      await expect(apiRequest('/friends')).rejects.toThrow()

      expect(getAccessToken()).toBeNull()
      expect(getRefreshToken()).toBeNull()
      expect(onAuthFailure).toHaveBeenCalled()
    })
  })
})