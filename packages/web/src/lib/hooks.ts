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
