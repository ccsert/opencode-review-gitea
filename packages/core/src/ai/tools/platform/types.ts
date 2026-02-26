/**
 * Platform Tool types
 * Shared context and result types for all platform management tools
 */

import type { GitProvider } from "../../../providers/types";

/**
 * Error codes for tool results
 */
export enum ToolErrorCode {
  NOT_FOUND = "NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  PROVIDER_ERROR = "PROVIDER_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Discriminated union result type for all tools
 */
export type ToolResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: ToolErrorCode };

/**
 * Database interface for platform tools
 * Abstract over Drizzle to keep core independent of DB implementation
 */
export interface PlatformDB {
  query: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * Context injected into every platform tool at creation time
 */
export interface PlatformToolContext {
  /** Database access (abstracted) */
  db: PlatformDB;
  /** Current authenticated user ID */
  userId: string;
  /** User role for permission checks */
  userRole: "admin" | "member" | "viewer";
  /** Organization ID (multi-tenant, optional) */
  orgId?: string;
  /** Git provider instance for repo operations */
  gitProvider?: GitProvider;
}

/**
 * Helper to create a success result
 */
export function ok<T>(data: T): ToolResult<T> {
  return { success: true, data };
}

/**
 * Helper to create an error result
 */
export function err<T>(error: string, code: ToolErrorCode): ToolResult<T> {
  return { success: false, error, code };
}
