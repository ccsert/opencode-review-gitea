// Auth
export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  user: User;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
}

// Repository
export interface Repository {
  id: string;
  name: string;
  owner: string;
  provider: string;
}

export interface CreateRepositoryInput {
  name: string;
  owner: string;
  provider: string;
  url: string;
  token: string;
}

// Template
export interface Template {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  userPrompt: string;
  isSystem: boolean;
  isDefault: boolean;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  userPrompt?: string;
  isDefault?: boolean;
}

// Review
export interface Review {
  id: string;
  repositoryId: string;
  pullNumber: number;
  status: string;
  result?: unknown;
  createdAt: string;
}

export interface ReviewStats {
  total: number;
  approved: number;
  changesRequested: number;
}

// Agent
export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChatInput {
  messages: AgentMessage[];
  threadId?: string;
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

// Pagination
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// System
export interface SystemHealth {
  status: string;
  version: string;
  uptime: number;
}

export interface SystemInfo {
  version: string;
  database: string;
  providers: string[];
}
