/**
 * useAgentDataSync — watches for completed AI agent tool calls and
 * automatically invalidates the corresponding React Query caches so
 * the UI stays in sync without a manual page refresh.
 *
 * This hook reads the CopilotKit message stream, detects tool-result
 * messages, maps the tool name to React Query cache keys, and calls
 * `queryClient.invalidateQueries()`.
 */

import { useEffect, useRef } from "react";
import { useCopilotChatInternal } from "@copilotkit/react-core";
import { useQueryClient } from "@tanstack/react-query";

// ─── Tool Name → Query Key Mapping ──────────────────────────────────────────

/**
 * Maps platform agent tool names to the React Query cache keys that
 * should be invalidated when those tools complete successfully.
 *
 * Tool IDs come from `packages/core/src/ai/tools/platform/*.ts`
 */
const TOOL_QUERY_KEY_MAP: Record<string, string[][]> = {
  // Template tools
  "create-template": [["templates"]],
  "update-template": [["templates"], ["template"]],
  "delete-template": [["templates"]],
  "optimize-template": [["templates"], ["template"]],

  // Repository tools
  "configure-repo": [["repositories"], ["repository"]],

  // Webhook tools
  "register-webhook": [["repositories"], ["repository"]],
  "delete-webhook": [["repositories"], ["repository"]],

  // AI provider tools
  "configure-ai-provider": [["aiProviders"], ["aiProvider"]],

  // Review tools
  "trigger-review": [["reviews"], ["reviewStats"]],

  // System tools (dashboard data)
  "get-dashboard-data": [["reviewStats"], ["reviews"], ["repositories"]],
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface AGUIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface AGUIMessage {
  id: string;
  role: string;
  content?: string | unknown[] | null;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: AGUIToolCall[];
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAgentDataSync() {
  const { messages } = useCopilotChatInternal();
  const queryClient = useQueryClient();

  // Track which tool-result message IDs we have already processed so we
  // don't invalidate the same queries multiple times during re-renders.
  const processedIds = useRef(new Set<string>());

  useEffect(() => {
    const allMessages = (messages ?? []) as AGUIMessage[];

    // Build a lookup from toolCallId → tool name using assistant messages
    const toolCallNameMap = new Map<string, string>();
    for (const msg of allMessages) {
      if (msg.role === "assistant" && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.function?.name) {
            toolCallNameMap.set(tc.id, tc.function.name);
          }
        }
      }
    }

    // Find tool-result messages we haven't processed yet
    for (const msg of allMessages) {
      if (
        msg.role === "tool" &&
        msg.toolCallId &&
        !processedIds.current.has(msg.id)
      ) {
        processedIds.current.add(msg.id);

        const toolName = msg.toolName || toolCallNameMap.get(msg.toolCallId);
        if (!toolName) continue;

        const queryKeys = TOOL_QUERY_KEY_MAP[toolName];
        if (queryKeys && queryKeys.length > 0) {
          for (const key of queryKeys) {
            queryClient.invalidateQueries({ queryKey: key });
          }
        }
      }
    }
  }, [messages, queryClient]);
}
