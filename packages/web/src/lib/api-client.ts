import { useAuthStore } from '@/stores/auth'

const API_BASE_URL = '/api/v1'

interface FetchOptions extends RequestInit {
  skipAuth?: boolean
}

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async request<T>(
    endpoint: string,
    options: FetchOptions = {}
  ): Promise<T> {
    const { skipAuth = false, headers = {}, ...restOptions } = options
    const authStore = useAuthStore.getState()

    const requestHeaders: HeadersInit = {
      'Content-Type': 'application/json',
      ...headers,
    }

    if (!skipAuth && authStore.accessToken) {
      ;(requestHeaders as Record<string, string>)['Authorization'] =
        `Bearer ${authStore.accessToken}`
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...restOptions,
      headers: requestHeaders,
    })

    if (response.status === 401 && !skipAuth) {
      // Try to refresh token
      const refreshed = await this.refreshToken()
      if (refreshed) {
        // Retry the request with new token
        const newAuthStore = useAuthStore.getState()
        ;(requestHeaders as Record<string, string>)['Authorization'] =
          `Bearer ${newAuthStore.accessToken}`
        const retryResponse = await fetch(`${this.baseUrl}${endpoint}`, {
          ...restOptions,
          headers: requestHeaders,
        })
        if (!retryResponse.ok) {
          throw new Error(`HTTP error! status: ${retryResponse.status}`)
        }
        return retryResponse.json()
      } else {
        authStore.clearTokens()
        throw new Error('Session expired')
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || `HTTP error! status: ${response.status}`)
    }

    return response.json()
  }

  private async refreshToken(): Promise<boolean> {
    const authStore = useAuthStore.getState()
    if (!authStore.refreshToken) return false

    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: authStore.refreshToken }),
      })

      if (!response.ok) return false

      const data = await response.json()
      authStore.setTokens(data.accessToken, data.refreshToken)
      return true
    } catch {
      return false
    }
  }

  async get<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' })
  }

  async post<T>(
    endpoint: string,
    data?: unknown,
    options?: FetchOptions
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async put<T>(
    endpoint: string,
    data?: unknown,
    options?: FetchOptions
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async delete<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' })
  }
}

export const apiClient = new ApiClient(API_BASE_URL)
