/**
 * AgentPanel — sliding sidebar panel for chatting with the platform agent
 *
 * Uses ai-elements components (Conversation, Message, PromptInput, Suggestion)
 * to provide a beautiful, consistent chat UI powered by CopilotKit runtime.
 */

import { useCallback, useState, Fragment, type ReactNode } from "react";
import { useCopilotChatInternal, useCopilotChatSuggestions } from "@copilotkit/react-core";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";
import {
  Bot,
  X,
  Copy,
  Trash2,
  MessageSquare,
  Wrench,
  Check,
  Loader2,
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
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { AgentStateIndicator } from "./AgentStateIndicator";
import { ToolCallVisualization } from "./ToolCallVisualization";
import { ConfirmAction } from "./ConfirmAction";
import { useCopilotAvailable } from "./useCopilotAvailable";

// ─── Inline Tool Card ─────────────────────────────────────────────────────────

interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "executing" | "complete" | "inProgress";
}

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
  content?: string | AGUIContentPart[];
  name?: string;
  toolCalls?: AGUIToolCall[];
  toolCallId?: string;
  toolName?: string;
  generativeUI?: (() => ReactNode) | null;
  generativeUIPosition?: "before" | "after";
}

function InlineToolCard({ tool }: { tool: ToolCallInfo }) {
  const displayName = tool.name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/-/g, " ");

  const isComplete = tool.status === "complete";

  return (
    <div className="my-1.5 rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="font-medium text-foreground truncate">{displayName}</span>
        {isComplete ? (
          <span className="ml-auto flex items-center gap-1 text-green-600 text-[10px] font-medium shrink-0">
            <Check className="h-3 w-3" /> Done
          </span>
        ) : (
          <span className="ml-auto flex items-center gap-1 text-blue-500 text-[10px] font-medium shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" /> Running
          </span>
        )}
      </div>
      {tool.result && isComplete && (
        <div className="mt-1.5 max-h-20 overflow-auto rounded bg-muted/40 p-1.5 text-[11px] text-muted-foreground">
          <code className="whitespace-pre-wrap break-all">
            {tool.result.length > 200 ? tool.result.slice(0, 200) + "…" : tool.result}
          </code>
        </div>
      )}
    </div>
  );
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
      {/* Register CopilotKit action hooks (catch-all renderer + confirmations) */}
      <ToolCallVisualization />
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
  const renderMessages = ((aguiMessages ?? []) as AGUIMessage[]).filter(
    (msg) =>
      msg.role !== "system" &&
      msg.role !== "developer" &&
      msg.role !== "activity" &&
      msg.name !== "coagent-state-render"
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
                const textContent =
                  typeof msg.content === "string"
                    ? msg.content
                    : Array.isArray(msg.content)
                      ? (msg.content as AGUIContentPart[])
                          .filter((p) => p.type === "text")
                          .map((p) => p.text)
                          .join("")
                      : "";

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
                const textContent =
                  typeof msg.content === "string"
                    ? msg.content
                    : Array.isArray(msg.content)
                      ? (msg.content as AGUIContentPart[])
                          .filter((p) => p.type === "text")
                          .map((p) => p.text)
                          .join("")
                      : "";
                const isLastAssistant =
                  index === renderMessages.length - 1 && !isLoading;

                // If the message has a generativeUI renderer, use it
                if (msg.generativeUI && typeof msg.generativeUI === "function") {
                  const rendered = msg.generativeUI();
                  if (rendered) {
                    return <Fragment key={msg.id}>{rendered}</Fragment>;
                  }
                }

                // Render inline tool call cards for tool invocations
                const toolCalls = msg.toolCalls;
                if (toolCalls && toolCalls.length > 0 && !textContent) {
                  return (
                    <Fragment key={msg.id}>
                      {toolCalls.map((tc) => (
                        <InlineToolCard
                          key={tc.id}
                          tool={{
                            id: tc.id,
                            name: tc.function?.name || "Tool",
                            args: tc.function?.arguments
                              ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })()
                              : {},
                            status: "executing",
                          }}
                        />
                      ))}
                    </Fragment>
                  );
                }

                // Only render if there's text content
                if (!textContent) return null;

                return (
                  <Fragment key={msg.id}>
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
                  </Fragment>
                );
              }

              // Tool result messages
              if (msgRole === "tool") {
                return (
                  <InlineToolCard
                    key={msg.id}
                    tool={{
                      id: msg.id,
                      name: msg.toolName || msg.name || "Tool",
                      args: {},
                      result:
                        typeof msg.content === "string"
                          ? msg.content
                          : JSON.stringify(msg.content),
                      status: "complete",
                    }}
                  />
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
