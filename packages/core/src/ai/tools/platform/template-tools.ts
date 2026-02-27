/**
 * Template management tools for the platform AI agent.
 * All DB access is injected via TemplateToolDeps — core stays DB-independent.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { PlatformToolContext } from "./types";
import { ToolErrorCode } from "./types";
import {
  renderTemplate,
  validateTemplate,
  getAvailableVariables,
} from "../../../templates/renderer";
import type { TemplateContext } from "../../../templates/renderer";

/**
 * Dependency injection interface for template data access.
 * Implemented by the server package against the actual DB layer.
 */
export interface TemplateToolDeps {
  listTemplates: (userId: string) => Promise<
    Array<{
      id: string;
      name: string;
      description?: string | null;
      isSystem: boolean;
      isDefault: boolean;
      categories?: string[] | null;
      severities?: string[] | null;
      createdAt?: Date | null;
    }>
  >;
  getTemplate: (id: string) => Promise<{
    id: string;
    name: string;
    description?: string | null;
    systemPrompt: string;
    isSystem: boolean;
    isDefault: boolean;
    categories?: string[] | null;
    severities?: string[] | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
  } | null>;
  createTemplate: (data: {
    userId: string;
    name: string;
    description?: string;
    systemPrompt: string;
    categories?: string[];
    severities?: string[];
  }) => Promise<{ id: string; name: string }>;
  updateTemplate: (
    id: string,
    data: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      categories?: string[];
      severities?: string[];
      isDefault?: boolean;
    },
  ) => Promise<{ id: string; updated: boolean } | null>;
  deleteTemplate: (id: string) => Promise<boolean>;
  isSystemTemplate: (id: string) => boolean;
}

/** Sample context used for template testing/rendering preview */
const SAMPLE_TEMPLATE_CONTEXT: TemplateContext = {
  repo: { name: "owner/sample-repo", provider: "gitea" },
  pr: {
    number: 42,
    title: "feat: Add sample feature",
    author: "developer",
    branch: { source: "feature/sample", target: "main" },
  },
  files: { count: 3, list: ["src/index.ts", "src/utils.ts", "README.md"] },
  config: { language: "en", style: "detailed" },
  date: new Date().toISOString().split("T")[0],
};

/**
 * Creates the template management toolset for platform agents.
 *
 * @param ctx  - Authenticated platform context (userId, userRole, etc.)
 * @param deps - DB callbacks injected by the server layer
 */
export function createTemplateTools(
  ctx: PlatformToolContext,
  deps: TemplateToolDeps,
) {
  return {
    listTemplates: createTool({
      id: "list-templates",
      description: "List all review templates available to the current user",
      inputSchema: z.object({
        includeSystem: z
          .boolean()
          .optional()
          .default(true)
          .describe("Include system templates in the result"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              description: z.string().nullable().optional(),
              isSystem: z.boolean(),
              isDefault: z.boolean(),
            }),
          )
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const templates = await deps.listTemplates(ctx.userId);
          const filtered = inputData.includeSystem
            ? templates
            : templates.filter((t) => !t.isSystem);
          return {
            success: true as const,
            data: filtered.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description ?? null,
              isSystem: t.isSystem,
              isDefault: t.isDefault,
            })),
          };
        } catch (e) {
          return {
            success: false as const,
            error: String(e),
            code: ToolErrorCode.INTERNAL_ERROR,
          };
        }
      },
    }),

    getTemplate: createTool({
      id: "get-template",
      description:
        "Get detailed information about a specific review template by ID",
      inputSchema: z.object({
        templateId: z.string().describe("The template ID to look up"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable().optional(),
            systemPrompt: z.string(),
            isSystem: z.boolean(),
            isDefault: z.boolean(),
            categories: z.array(z.string()).nullable().optional(),
            severities: z.array(z.string()).nullable().optional(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const template = await deps.getTemplate(inputData.templateId);
          if (!template) {
            return {
              success: false as const,
              error: `Template not found: ${inputData.templateId}`,
              code: ToolErrorCode.NOT_FOUND,
            };
          }
          return {
            success: true as const,
            data: {
              id: template.id,
              name: template.name,
              description: template.description ?? null,
              systemPrompt: template.systemPrompt,
              isSystem: template.isSystem,
              isDefault: template.isDefault,
              categories: template.categories ?? null,
              severities: template.severities ?? null,
            },
          };
        } catch (e) {
          return {
            success: false as const,
            error: String(e),
            code: ToolErrorCode.INTERNAL_ERROR,
          };
        }
      },
    }),

    createTemplate: createTool({
      id: "create-template",
      description: "Create a new review template",
      inputSchema: z.object({
        name: z.string().describe("Template name"),
        systemPrompt: z.string().describe("The system prompt template content"),
        description: z.string().optional().describe("Template description"),
        categories: z
          .array(z.string())
          .optional()
          .describe("Review categories"),
        severities: z
          .array(z.string())
          .optional()
          .describe("Review severities"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            id: z.string(),
            name: z.string(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const result = await deps.createTemplate({
            userId: ctx.userId,
            name: inputData.name,
            systemPrompt: inputData.systemPrompt,
            description: inputData.description,
            categories: inputData.categories,
            severities: inputData.severities,
          });
          return {
            success: true as const,
            data: { id: result.id, name: result.name },
          };
        } catch (e) {
          return {
            success: false as const,
            error: String(e),
            code: ToolErrorCode.INTERNAL_ERROR,
          };
        }
      },
    }),

    updateTemplate: createTool({
      id: "update-template",
      description:
        "Update an existing review template. Cannot modify system templates.",
      inputSchema: z.object({
        templateId: z.string().describe("The template ID to update"),
        name: z.string().optional().describe("New template name"),
        systemPrompt: z
          .string()
          .optional()
          .describe("New system prompt content"),
        description: z.string().optional().describe("New description"),
        categories: z.array(z.string()).optional().describe("New categories"),
        severities: z.array(z.string()).optional().describe("New severities"),
        isDefault: z.boolean().optional().describe("Set as default template"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            id: z.string(),
            updated: z.boolean(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          if (deps.isSystemTemplate(inputData.templateId)) {
            return {
              success: false as const,
              error: "Cannot modify system templates",
              code: ToolErrorCode.PERMISSION_DENIED,
            };
          }
          const result = await deps.updateTemplate(inputData.templateId, {
            name: inputData.name,
            description: inputData.description,
            systemPrompt: inputData.systemPrompt,
            categories: inputData.categories,
            severities: inputData.severities,
            isDefault: inputData.isDefault,
          });
          if (!result) {
            return {
              success: false as const,
              error: `Template not found: ${inputData.templateId}`,
              code: ToolErrorCode.NOT_FOUND,
            };
          }
          return {
            success: true as const,
            data: { id: result.id, updated: result.updated },
          };
        } catch (e) {
          return {
            success: false as const,
            error: String(e),
            code: ToolErrorCode.INTERNAL_ERROR,
          };
        }
      },
    }),

    deleteTemplate: createTool({
      id: "delete-template",
      description: "Delete a review template. Cannot delete system templates.",
      inputSchema: z.object({
        templateId: z.string().describe("The template ID to delete"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            deleted: z.boolean(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          if (deps.isSystemTemplate(inputData.templateId)) {
            return {
              success: false as const,
              error: "Cannot delete system templates",
              code: ToolErrorCode.PERMISSION_DENIED,
            };
          }
          const deleted = await deps.deleteTemplate(inputData.templateId);
          if (!deleted) {
            return {
              success: false as const,
              error: `Template not found: ${inputData.templateId}`,
              code: ToolErrorCode.NOT_FOUND,
            };
          }
          return {
            success: true as const,
            data: { deleted: true },
          };
        } catch (e) {
          return {
            success: false as const,
            error: String(e),
            code: ToolErrorCode.INTERNAL_ERROR,
          };
        }
      },
    }),

    testTemplate: createTool({
      id: "test-template",
      description:
        "Validate and test-render a template with sample data. Returns validation result, available variables, and rendered output.",
      inputSchema: z.object({
        systemPrompt: z
          .string()
          .describe("The template content to validate and test"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            valid: z.boolean(),
            variables: z.array(z.string()),
            availableVariables: z.array(
              z.object({
                key: z.string(),
                description: z.string(),
                example: z.string(),
              }),
            ),
            rendered: z.string(),
            errors: z.array(z.string()),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const validation = validateTemplate(inputData.systemPrompt);
          const rendered = renderTemplate(
            inputData.systemPrompt,
            SAMPLE_TEMPLATE_CONTEXT,
          );
          const availableVariables = getAvailableVariables();

          return {
            success: true as const,
            data: {
              valid: validation.valid,
              variables: validation.variables,
              availableVariables,
              rendered,
              errors: validation.errors,
            },
          };
        } catch (e) {
          return {
            success: false as const,
            error: String(e),
            code: ToolErrorCode.INTERNAL_ERROR,
          };
        }
      },
    }),

    optimizeTemplate: createTool({
      id: "optimize-template",
      description:
        "Analyze a template and return optimization suggestions. Checks variable usage, length, and structure.",
      inputSchema: z.object({
        systemPrompt: z.string().describe("The template content to analyze"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            length: z.number(),
            variablesUsed: z.array(z.string()),
            unusedVariables: z.array(z.string()),
            suggestions: z.array(z.string()),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const validation = validateTemplate(inputData.systemPrompt);
          const available = getAvailableVariables();
          const availableKeys = available.map((v) =>
            v.key.replace(/\{\{|\}\}/g, ""),
          );

          const unusedVariables = availableKeys.filter(
            (key) => !validation.variables.includes(key),
          );

          const suggestions: string[] = [];

          if (inputData.systemPrompt.length < 50) {
            suggestions.push(
              "Template is very short. Consider adding more specific review instructions.",
            );
          }
          if (inputData.systemPrompt.length > 5000) {
            suggestions.push(
              "Template is very long. Consider splitting into focused sections.",
            );
          }
          if (validation.variables.length === 0) {
            suggestions.push(
              "No template variables used. Consider using {{repo.name}}, {{pr.title}}, etc. for dynamic content.",
            );
          }
          if (unusedVariables.length > 0) {
            suggestions.push(
              `Available but unused variables: ${unusedVariables.join(", ")}. Consider using them for more context.`,
            );
          }
          if (validation.errors.length > 0) {
            suggestions.push(
              `Template has ${validation.errors.length} syntax error(s). Fix them for reliable rendering.`,
            );
          }

          return {
            success: true as const,
            data: {
              length: inputData.systemPrompt.length,
              variablesUsed: validation.variables,
              unusedVariables,
              suggestions,
            },
          };
        } catch (e) {
          return {
            success: false as const,
            error: String(e),
            code: ToolErrorCode.INTERNAL_ERROR,
          };
        }
      },
    }),
  };
}
