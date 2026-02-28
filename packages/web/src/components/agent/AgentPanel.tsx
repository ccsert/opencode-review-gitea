/**
 * AgentPanel — sliding sidebar panel for chatting with the platform agent
 *
 * Uses ai-elements components (Conversation, Message, PromptInput, Suggestion,
 * Tool) to provide a beautiful, consistent chat UI powered by CopilotKit runtime.
 *
 * Tool calls are rendered inline using ai-elements Tool components — we do NOT
 * use CopilotKit's generativeUI / useCopilotAction catch-all renderer because
 * it duplicates tool cards and swallows assistant text content.
 */

import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useCopilotChatInternal, useCopilotChatSuggestions } from "@copilotkit/react-core";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";
import {
  Bot,
  X,
  Copy,
  Trash2,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgentUIStore } from "@/stores/agent-ui";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputBody,
  PromptInputFooter,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { AgentStateIndicator } from "./AgentStateIndicator";
import { ConfirmAction } from "./ConfirmAction";
import { useCopilotAvailable } from "./useCopilotAvailable";
import { useAgentDataSync } from "./useAgentDataSync";

// ─── Types ────────────────────────────────────────────────────────────────────

// AG-UI message types (CopilotKit v1.52+ uses these internally)
interface AGUIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface AGUIContentPart {
  type: string;
  text?: string;
  toolCallId?: string;
  id?: string;
  name?: string;
  toolName?: string;
}

interface AGUIMessage {
  id: string;
  role: string;
  content?: string | AGUIContentPart[] | null;
  name?: string;
  toolCalls?: AGUIToolCall[];
  toolCallId?: string;
  toolName?: string;
}

type AssistantRenderSegment =
  | { type: "text"; key: string; text: string }
  | { type: "tool"; key: string; toolCall: AGUIToolCall };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract plain-text content from a message, handling all known shapes. */
function extractTextContent(msg: AGUIMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as AGUIContentPart[])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("");
  }
  return "";
}

/** Human-readable tool name */
function formatToolName(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/-/g, " ")
    .trim();
}

/** Map our status to ai-elements ToolUIPart state */
function mapToolStatus(complete: boolean): "input-available" | "output-available" {
  return complete ? "output-available" : "input-available";
}

/** Parse JSON safely */
function safeParseJSON(str: string): Record<string, unknown> {
  try { return JSON.parse(str); } catch { return {}; }
}

function splitLeadAndTailText(text: string): { lead: string; tail: string } {
  const trimmed = text.trim();
  if (!trimmed) return { lead: "", tail: "" };

  const paragraphMatch = /\n\s*\n/.exec(trimmed);
  if (paragraphMatch && paragraphMatch.index > 0) {
    const lead = trimmed.slice(0, paragraphMatch.index).trim();
    const tail = trimmed.slice(paragraphMatch.index).trim();
    return { lead, tail };
  }

  const sentencePunctuation = ["。", "！", "？", ". ", "! ", "? "];
  for (const marker of sentencePunctuation) {
    const idx = trimmed.indexOf(marker);
    if (idx > 0 && idx < trimmed.length - marker.length) {
      const lead = trimmed.slice(0, idx + marker.length).trim();
      const tail = trimmed.slice(idx + marker.length).trim();
      if (lead && tail) {
        return { lead, tail };
      }
    }
  }

  return { lead: trimmed, tail: "" };
}

function buildAssistantSegments(msg: AGUIMessage): AssistantRenderSegment[] {
  const segments: AssistantRenderSegment[] = [];
  const toolCalls = msg.toolCalls ?? [];
  const usedToolCallIds = new Set<string>();

  if (Array.isArray(msg.content)) {
    for (let index = 0; index < msg.content.length; index++) {
      const part = msg.content[index];

      if (part.type === "text" && part.text?.trim()) {
        segments.push({
          type: "text",
          key: `${msg.id}-text-${index}`,
          text: part.text,
        });
        continue;
      }

      const partToolCallId = part.toolCallId || part.id;
      const partToolName = part.toolName || part.name;
      const matchedToolCall = toolCalls.find((tc) => {
        if (usedToolCallIds.has(tc.id)) return false;
        if (partToolCallId && tc.id === partToolCallId) return true;
        if (partToolName && tc.function?.name === partToolName) return true;
        return false;
      });

      if (matchedToolCall) {
        usedToolCallIds.add(matchedToolCall.id);
        segments.push({
          type: "tool",
          key: `${msg.id}-tool-${matchedToolCall.id}`,
          toolCall: matchedToolCall,
        });
      }
    }
  }

  if (segments.length === 0) {
    const textContent = extractTextContent(msg);
    if (textContent && toolCalls.length > 0) {
      const { lead, tail } = splitLeadAndTailText(textContent);
      if (lead) {
        segments.push({ type: "text", key: `${msg.id}-text-lead`, text: lead });
      }
      for (const tc of toolCalls) {
        segments.push({
          type: "tool",
          key: `${msg.id}-tool-${tc.id}`,
          toolCall: tc,
        });
      }
      if (tail) {
        segments.push({ type: "text", key: `${msg.id}-text-tail`, text: tail });
      }
      return segments;
    }

    if (textContent) {
      segments.push({ type: "text", key: `${msg.id}-text`, text: textContent });
    }
    for (const tc of toolCalls) {
      segments.push({
        type: "tool",
        key: `${msg.id}-tool-${tc.id}`,
        toolCall: tc,
      });
    }
    return segments;
  }

  for (const tc of toolCalls) {
    if (!usedToolCallIds.has(tc.id)) {
      segments.push({
        type: "tool",
        key: `${msg.id}-tool-${tc.id}`,
        toolCall: tc,
      });
    }
  }

  const firstTextIndex = segments.findIndex((seg) => seg.type === "text");
  if (firstTextIndex > 0) {
    const leadingTools = segments.slice(0, firstTextIndex).filter((seg) => seg.type === "tool");
    if (leadingTools.length > 0) {
      const textAndRest = segments.slice(firstTextIndex);
      return [textAndRest[0], ...leadingTools, ...textAndRest.slice(1)];
    }
  }

  return segments;
}

// ─── Auto-Collapsing Tool ─────────────────────────────────────────────────────

/**
 * Auto-collapsing Tool wrapper.
 * - Starts open while the tool is running (isComplete=false)
 * - Auto-collapses when the tool finishes (isComplete transitions to true)
 * - User can still manually toggle open/close at any time
 *
 * Uses the "adjusting state when a prop changes" pattern recommended by React:
 * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 */
function AutoCollapsingTool({
  isComplete,
  children,
  ...props
}: { isComplete: boolean } & Omit<import("react").ComponentProps<typeof Tool>, 'open' | 'onOpenChange' | 'defaultOpen'>) {
  const [isOpen, setIsOpen] = useState(!isComplete);
  const [prevIsComplete, setPrevIsComplete] = useState(isComplete);

  // Adjust state during render (not in useEffect) to auto-collapse on completion
  if (isComplete !== prevIsComplete) {
    setPrevIsComplete(isComplete);
    if (isComplete) {
      setIsOpen(false);
    }
  }

  return (
    <Tool open={isOpen} onOpenChange={setIsOpen} {...props}>
      {children}
    </Tool>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AgentPanel() {
  const MIN_SIDEBAR_WIDTH = 360;
  const MAX_SIDEBAR_WIDTH = 720;

  const { t } = useTranslation();
  const { isOpen, setOpen, sidebarWidth, setSidebarWidth } = useAgentUIStore();
  const available = useCopilotAvailable();
  const [input, setInput] = useState("");
  const [isResizing, setIsResizing] = useState(false);

  const clampWidth = useCallback(
    (value: number) => {
      const viewportMax = typeof window === "undefined"
        ? MAX_SIDEBAR_WIDTH
        : Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 24));
      return Math.max(MIN_SIDEBAR_WIDTH, Math.min(viewportMax, value));
    },
    [MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH]
  );

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();

      const startX = event.clientX;
      const startWidth = sidebarWidth;
      setIsResizing(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = startX - moveEvent.clientX;
        setSidebarWidth(clampWidth(startWidth + delta));
      };

      const handlePointerUp = () => {
        setIsResizing(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [clampWidth, setSidebarWidth, sidebarWidth]
  );

  useEffect(() => {
    const normalizedWidth = clampWidth(sidebarWidth);
    if (normalizedWidth !== sidebarWidth) {
      setSidebarWidth(normalizedWidth);
    }
  }, [clampWidth, setSidebarWidth, sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  useEffect(() => {
    document.documentElement.style.setProperty("--agent-sidebar-width", `${sidebarWidth}px`);
  }, [sidebarWidth]);

  // Guard: CopilotKit hooks require an active CopilotKit context.
  if (!available) return null;

  return (
    <>
      {/* Register confirmation hooks for dangerous tools only */}
      <ConfirmAction />

      {/* Floating trigger button */}
      <Button
        variant="default"
        size="icon"
        className={cn(
          "fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg transition-all duration-300 hover:scale-105",
          isOpen
            ? "translate-x-[200%] opacity-0 pointer-events-none"
            : "translate-x-0 opacity-100"
        )}
        onClick={() => setOpen(true)}
        aria-label={t("agent.openChat")}
      >
        <Bot className="h-5 w-5" />
      </Button>

      {/* Sidebar panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex max-w-full w-(--agent-sidebar-width) flex-col border-l bg-background shadow-xl transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div
          role="separator"
          aria-label="Resize agent sidebar"
          className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1 cursor-col-resize"
          onPointerDown={handleResizeStart}
        />

        {/* ── Header ── */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-semibold">{t("agent.title")}</span>
            <AgentStateIndicator />
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => {
                /* reset is called inside AgentChatContent */
              }}
              aria-label={t("agent.newChat")}
              title={t("agent.newChat")}
              id="agent-reset-btn"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ── Chat ── */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <AgentChatContent input={input} setInput={setInput} />
        </div>
      </div>
    </>
  );
}

// ─── Chat Content ─────────────────────────────────────────────────────────────

function AgentChatContent({
  input,
  setInput,
}: {
  input: string;
  setInput: (v: string) => void;
}) {
  const { t } = useTranslation();
  const {
    messages: aguiMessages,
    sendMessage,
    isLoading,
    stopGeneration,
    reset,
  } = useCopilotChatInternal();

  // Auto-sync: invalidate React Query caches when agent tool calls complete
  useAgentDataSync();

  // Default suggestions
  useCopilotChatSuggestions({
    instructions: t("agent.welcomeMessage"),
    maxSuggestions: 3,
  });

  // Wire the header reset button to the hook
  const resetBtn = typeof document !== "undefined"
    ? document.getElementById("agent-reset-btn")
    : null;
  if (resetBtn) {
    resetBtn.onclick = () => reset();
  }

  // ── Send message ──
  const sendUserMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      sendMessage({
        id: nanoid(),
        role: "user" as const,
        content: trimmed,
      });
    },
    [sendMessage]
  );

  const handleSubmit = useCallback(() => {
    sendUserMessage(input);
    setInput("");
  }, [input, sendUserMessage, setInput]);

  const handleSuggestionClick = useCallback(
    (suggestion: string) => sendUserMessage(suggestion),
    [sendUserMessage]
  );

  // ── Filter messages ──
  // Build a set of tool-result message IDs so we can skip them in the main loop
  // (they are merged into the corresponding assistant message's tool cards).
  const allMessages = (aguiMessages ?? []) as AGUIMessage[];
  const toolResultMap = new Map<string, AGUIMessage>();
  const toolResultIds = new Set<string>();
  for (const msg of allMessages) {
    if (msg.role === "tool" && msg.toolCallId) {
      toolResultMap.set(msg.toolCallId, msg);
      toolResultIds.add(msg.id);
    }
  }

  const renderMessages = allMessages.filter(
    (msg) =>
      msg.role !== "system" &&
      msg.role !== "developer" &&
      msg.role !== "activity" &&
      msg.name !== "coagent-state-render" &&
      !toolResultIds.has(msg.id) // skip standalone tool-result messages
  );
  const hasMessages = renderMessages.length > 0;

  let lastAssistantTextIdx = -1;
  for (let i = renderMessages.length - 1; i >= 0; i--) {
    const msg = renderMessages[i];
    if (
      msg.role === "assistant" &&
      buildAssistantSegments(msg).some((seg) => seg.type === "text")
    ) {
      lastAssistantTextIdx = i;
      break;
    }
  }

  return (
    <>
      {/* Messages */}
      <Conversation className="flex-1">
        <ConversationContent className="gap-3 px-4 py-4">
          {!hasMessages ? (
            /* ── Empty state ── */
            <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-primary/20 to-primary/5">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold">{t("agent.title")}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("agent.welcomeMessage")}
                </p>
              </div>
              <Suggestions className="mt-1 flex-wrap justify-center gap-2">
                <Suggestion
                  suggestion={t("agent.suggestion.listTemplates")}
                  onClick={handleSuggestionClick}
                />
                <Suggestion
                  suggestion={t("agent.suggestion.listRepos")}
                  onClick={handleSuggestionClick}
                />
                <Suggestion
                  suggestion={t("agent.suggestion.configAI")}
                  onClick={handleSuggestionClick}
                />
              </Suggestions>
            </div>
          ) : (
            /* ── Message list (strict renderMessages order) ── */
            renderMessages.map((msg, index) => {
              if (msg.role === "user") {
                const textContent = extractTextContent(msg);
                if (!textContent) return null;

                return (
                  <Message key={msg.id} from="user">
                    <MessageContent>
                      <MessageResponse>{textContent}</MessageResponse>
                    </MessageContent>
                  </Message>
                );
              }

              if (msg.role === "assistant") {
                const segments = buildAssistantSegments(msg);
                const hasText = segments.some((seg) => seg.type === "text");

                if (segments.length === 0) return null;

                const showCopyAction =
                  hasText && index === lastAssistantTextIdx && !isLoading;

                const copyText = segments
                  .filter(
                    (seg): seg is Extract<AssistantRenderSegment, { type: "text" }> =>
                      seg.type === "text",
                  )
                  .map((seg) => seg.text)
                  .join("\n\n");

                return (
                  <Message key={msg.id} from="assistant">
                    {segments.map((seg) => {
                      if (seg.type === "text") {
                        return (
                          <MessageContent key={seg.key}>
                            <MessageResponse>{seg.text}</MessageResponse>
                          </MessageContent>
                        );
                      }

                      const tc = seg.toolCall;
                        const resultMsg = toolResultMap.get(tc.id);
                        const isComplete = !!resultMsg;
                        const args = tc.function?.arguments
                          ? safeParseJSON(tc.function.arguments)
                          : {};
                        const hasArgs = Object.keys(args).length > 0;
                        const result = resultMsg
                          ? typeof resultMsg.content === "string"
                            ? resultMsg.content
                            : JSON.stringify(resultMsg.content)
                          : undefined;
                        const state = mapToolStatus(isComplete);

                      return (
                        <AutoCollapsingTool key={seg.key} isComplete={isComplete}>
                          <ToolHeader
                            title={formatToolName(tc.function?.name || "Tool")}
                            type="tool-invocation"
                            state={state}
                          />
                          {(hasArgs || result != null) && (
                            <ToolContent>
                              {hasArgs && <ToolInput input={args} />}
                              {result != null && isComplete && (
                                <ToolOutput output={result} errorText={undefined} />
                              )}
                            </ToolContent>
                          )}
                        </AutoCollapsingTool>
                      );
                    })}

                    {showCopyAction && (
                      <MessageActions>
                        <MessageAction
                          tooltip={t("common.copy", "复制")}
                          label="Copy"
                          onClick={() => navigator.clipboard.writeText(copyText)}
                        >
                          <Copy className="h-3 w-3" />
                        </MessageAction>
                      </MessageActions>
                    )}
                  </Message>
                );
              }

              return null;
            })
          )}

          {/* Loading indicator */}
          {isLoading && (
            <Message from="assistant">
              <MessageContent>
                <div className="flex items-center gap-1.5 py-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
                </div>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* ── Input ── */}
      <div className="shrink-0 border-t bg-background/80 backdrop-blur-sm p-3">
        <PromptInput onSubmit={handleSubmit} className="w-full">
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder={t("agent.inputPlaceholder")}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <div />
            <PromptInputSubmit
              status={isLoading ? "streaming" : "ready"}
              onStop={isLoading ? stopGeneration : undefined}
              disabled={!input.trim() && !isLoading}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  );
}
