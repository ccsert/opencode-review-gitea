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

import { useCallback, useState, Fragment } from "react";
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

// ─── Main Component ───────────────────────────────────────────────────────────

export function AgentPanel() {
  const { t } = useTranslation();
  const { isOpen, setOpen } = useAgentUIStore();
  const available = useCopilotAvailable();
  const [input, setInput] = useState("");

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
          "fixed inset-y-0 right-0 z-50 flex w-105 max-w-full flex-col border-l bg-background shadow-xl transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
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
            /* ── Message list ── */
            renderMessages.map((msg, index) => {
              const msgRole = msg.role;

              // User messages
              if (msgRole === "user") {
                const textContent = extractTextContent(msg);
                if (!textContent) return null;

                return (
                  <Fragment key={msg.id}>
                    <Message from="user">
                      <MessageContent>
                        <MessageResponse>{textContent}</MessageResponse>
                      </MessageContent>
                    </Message>
                  </Fragment>
                );
              }

              // Assistant messages
              if (msgRole === "assistant") {
                const textContent = extractTextContent(msg);
                const isLastAssistant =
                  index === renderMessages.length - 1 && !isLoading;

                const toolCalls = msg.toolCalls;
                const hasToolCalls = toolCalls && toolCalls.length > 0;
                const hasText = !!textContent;

                // Skip completely empty assistant messages
                if (!hasText && !hasToolCalls) return null;

                return (
                  <Fragment key={msg.id}>
                    {/* Tool call cards (using ai-elements Tool) */}
                    {hasToolCalls &&
                      toolCalls.map((tc) => {
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
                          <Tool key={tc.id} defaultOpen={!isComplete}>
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
                          </Tool>
                        );
                      })}

                    {/* Text content */}
                    {hasText && (
                      <Message from="assistant">
                        <MessageContent>
                          <MessageResponse>{textContent}</MessageResponse>
                        </MessageContent>
                        {isLastAssistant && (
                          <MessageActions>
                            <MessageAction
                              tooltip={t("common.copy", "复制")}
                              label="Copy"
                              onClick={() =>
                                navigator.clipboard.writeText(textContent)
                              }
                            >
                              <Copy className="h-3 w-3" />
                            </MessageAction>
                          </MessageActions>
                        )}
                      </Message>
                    )}
                  </Fragment>
                );
              }

              // Tool result messages — already merged into assistant tool cards above.
              // If we encounter one here (shouldn't happen due to filter), skip it.
              if (msgRole === "tool") return null;

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
