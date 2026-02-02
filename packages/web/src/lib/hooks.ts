/**
 * API Hooks - 使用 React Query 封装 API 调用
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './api-client'
import type {
  Repository,
  CreateRepositoryInput,
  UpdateRepositoryInput,
  RepositoryWithWebhook,
  Review,
  ReviewDetail,
  ReviewStats,
  ReviewFilters,
  Template,
  CreateTemplateInput,
  UpdateTemplateInput,
  ApiKey,
  CreateApiKeyInput,
  CreatedApiKey,
  ApiResponse,
  PaginationMeta,
  AiProvider,
  AiProviderPreset,
  CreateAiProviderInput,
  UpdateAiProviderInput,
  TestAiConnectionInput,
  TestAiConnectionResult,
} from './types'

// ============ Repository Hooks ============

interface RepositoriesResponse {
  success: boolean
  data: Repository[]
  pagination: PaginationMeta
}

interface RepositoryListParams {
  page?: number
  pageSize?: number
  provider?: string
  enabled?: string
  search?: string
}

export function useRepositories(params: RepositoryListParams = {}) {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set('page', String(params.page))
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize))
  if (params.provider) searchParams.set('provider', params.provider)
  if (params.enabled) searchParams.set('enabled', params.enabled)
  if (params.search) searchParams.set('search', params.search)
  
  const query = searchParams.toString()
  
  return useQuery<RepositoriesResponse>({
    queryKey: ['repositories', params],
    queryFn: () => apiClient.get(`/repositories${query ? `?${query}` : ''}`),
  })
}

export function useRepository(id: string) {
  return useQuery<ApiResponse<RepositoryWithWebhook>>({
    queryKey: ['repository', id],
    queryFn: () => apiClient.get(`/repositories/${id}`),
    enabled: !!id,
  })
}

export function useCreateRepository() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<RepositoryWithWebhook>, Error, CreateRepositoryInput>({
    mutationFn: (data) => apiClient.post('/repositories', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
  })
}

export function useUpdateRepository() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<Repository>, Error, { id: string; data: UpdateRepositoryInput }>({
    mutationFn: ({ id, data }) => apiClient.put(`/repositories/${id}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
      queryClient.invalidateQueries({ queryKey: ['repository', variables.id] })
    },
  })
}

export function useDeleteRepository() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<void>, Error, string>({
    mutationFn: (id) => apiClient.delete(`/repositories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
  })
}

export function useTestRepositoryConnection() {
  return useMutation<ApiResponse<{ success: boolean }>, Error, string>({
    mutationFn: (id) => apiClient.post(`/repositories/${id}/test`),
  })
}

// ============ Review Hooks ============

interface ReviewsResponse {
  success: boolean
  data: {
    items: Review[]
    pagination: PaginationMeta
  }
}

export function useReviews(filters: ReviewFilters = {}) {
  const searchParams = new URLSearchParams()
  if (filters.repositoryId) searchParams.set('repositoryId', filters.repositoryId)
  if (filters.status) searchParams.set('status', filters.status)
  if (filters.decision) searchParams.set('decision', filters.decision)
  if (filters.prAuthor) searchParams.set('prAuthor', filters.prAuthor)
  if (filters.startDate) searchParams.set('startDate', filters.startDate)
  if (filters.endDate) searchParams.set('endDate', filters.endDate)
  if (filters.page) searchParams.set('page', String(filters.page))
  if (filters.limit) searchParams.set('limit', String(filters.limit))
  
  const query = searchParams.toString()
  
  return useQuery<ReviewsResponse>({
    queryKey: ['reviews', filters],
    queryFn: () => apiClient.get(`/reviews${query ? `?${query}` : ''}`),
  })
}

export function useReview(id: string) {
  return useQuery<ApiResponse<ReviewDetail>>({
    queryKey: ['review', id],
    queryFn: () => apiClient.get(`/reviews/${id}`),
    enabled: !!id,
  })
}

export function useReviewStats() {
  return useQuery<ApiResponse<ReviewStats>>({
    queryKey: ['reviewStats'],
    queryFn: () => apiClient.get('/reviews/stats'),
  })
}

// ============ Template Hooks ============

interface TemplatesResponse {
  success: boolean
  data: Template[]
}

export function useTemplates(includeSystem = true) {
  return useQuery<TemplatesResponse>({
    queryKey: ['templates', { includeSystem }],
    queryFn: () => apiClient.get(`/templates?includeSystem=${includeSystem}`),
  })
}

export function useTemplate(id: string) {
  return useQuery<ApiResponse<Template>>({
    queryKey: ['template', id],
    queryFn: () => apiClient.get(`/templates/${id}`),
    enabled: !!id,
  })
}

export function useCreateTemplate() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<Template>, Error, CreateTemplateInput>({
    mutationFn: (data) => apiClient.post('/templates', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<Template>, Error, { id: string; data: UpdateTemplateInput }>({
    mutationFn: ({ id, data }) => apiClient.put(`/templates/${id}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['template', variables.id] })
    },
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<void>, Error, string>({
    mutationFn: (id) => apiClient.delete(`/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}

// ============ API Key Hooks ============

interface ApiKeysResponse {
  success: boolean
  data: ApiKey[]
}

export function useApiKeys() {
  return useQuery<ApiKeysResponse>({
    queryKey: ['apiKeys'],
    queryFn: () => apiClient.get('/api-keys'),
  })
}

export function useCreateApiKey() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<CreatedApiKey>, Error, CreateApiKeyInput>({
    mutationFn: (data) => apiClient.post('/api-keys', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
    },
  })
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<void>, Error, string>({
    mutationFn: (id) => apiClient.delete(`/api-keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
    },
  })
}

// ============ Platform Hooks ============

import type {
  Platform,
  CreatePlatformInput,
  UpdatePlatformInput,
  Organization,
  RemoteRepository,
  ImportRepositoriesInput,
  ImportResult,
} from './types'

interface PlatformsResponse {
  success: boolean
  data: Platform[]
}

interface PlatformRepositoriesResponse {
  success: boolean
  data: {
    repositories: RemoteRepository[]
    hasMore: boolean
    page: number
    perPage: number
  }
}

interface PlatformOrganizationsResponse {
  success: boolean
  data: Organization[]
}

export function usePlatforms() {
  return useQuery<PlatformsResponse>({
    queryKey: ['platforms'],
    queryFn: () => apiClient.get('/platforms'),
  })
}

export function usePlatform(id: string) {
  return useQuery<ApiResponse<Platform>>({
    queryKey: ['platform', id],
    queryFn: () => apiClient.get(`/platforms/${id}`),
    enabled: !!id,
  })
}

export function useCreatePlatform() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<Platform>, Error, CreatePlatformInput>({
    mutationFn: (data) => apiClient.post('/platforms', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platforms'] })
    },
  })
}

export function useUpdatePlatform() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<Platform>, Error, { id: string; data: UpdatePlatformInput }>({
    mutationFn: ({ id, data }) => apiClient.put(`/platforms/${id}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['platforms'] })
      queryClient.invalidateQueries({ queryKey: ['platform', variables.id] })
    },
  })
}

export function useDeletePlatform() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<void>, Error, string>({
    mutationFn: (id) => apiClient.delete(`/platforms/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platforms'] })
    },
  })
}

interface PlatformReposParams {
  id: string
  page?: number
  perPage?: number
  org?: string
}

export function usePlatformRepositories(params: PlatformReposParams) {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set('page', String(params.page))
  if (params.perPage) searchParams.set('perPage', String(params.perPage))
  if (params.org) searchParams.set('org', params.org)
  
  const query = searchParams.toString()
  
  return useQuery<PlatformRepositoriesResponse>({
    queryKey: ['platformRepositories', params],
    queryFn: () => apiClient.get(`/platforms/${params.id}/repositories${query ? `?${query}` : ''}`),
    enabled: !!params.id,
  })
}

export function usePlatformOrganizations(id: string) {
  return useQuery<PlatformOrganizationsResponse>({
    queryKey: ['platformOrganizations', id],
    queryFn: () => apiClient.get(`/platforms/${id}/organizations`),
    enabled: !!id,
  })
}

export function useImportRepositories() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<ImportResult>, Error, ImportRepositoriesInput>({
    mutationFn: (data) => apiClient.post('/repositories/import', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
  })
}

// ============ AI Provider Hooks ============

interface AiProvidersResponse {
  success: boolean
  data: AiProvider[]
}

interface AiProviderPresetsResponse {
  success: boolean
  data: AiProviderPreset[]
}

export function useAiProviders() {
  return useQuery<AiProvidersResponse>({
    queryKey: ['aiProviders'],
    queryFn: () => apiClient.get('/ai-providers'),
  })
}

export function useAiProviderPresets() {
  return useQuery<AiProviderPresetsResponse>({
    queryKey: ['aiProviderPresets'],
    queryFn: () => apiClient.get('/ai-providers/presets'),
  })
}

export function useAiProvider(id: string) {
  return useQuery<ApiResponse<AiProvider>>({
    queryKey: ['aiProvider', id],
    queryFn: () => apiClient.get(`/ai-providers/${id}`),
    enabled: !!id,
  })
}

export function useCreateAiProvider() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<AiProvider>, Error, CreateAiProviderInput>({
    mutationFn: (data) => apiClient.post('/ai-providers', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
    },
  })
}

export function useUpdateAiProvider() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<AiProvider>, Error, { id: string; data: UpdateAiProviderInput }>({
    mutationFn: ({ id, data }) => apiClient.put(`/ai-providers/${id}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
      queryClient.invalidateQueries({ queryKey: ['aiProvider', variables.id] })
    },
  })
}

export function useDeleteAiProvider() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<void>, Error, string>({
    mutationFn: (id) => apiClient.delete(`/ai-providers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
    },
  })
}

export function useSetDefaultAiProvider() {
  const queryClient = useQueryClient()
  
  return useMutation<ApiResponse<{ id: string; isDefault: boolean }>, Error, string>({
    mutationFn: (id) => apiClient.post(`/ai-providers/${id}/set-default`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
    },
  })
}

export function useTestAiConnection() {
  return useMutation<ApiResponse<TestAiConnectionResult>, Error, TestAiConnectionInput>({
    mutationFn: (data) => apiClient.post('/ai-providers/test', data),
  })
}
