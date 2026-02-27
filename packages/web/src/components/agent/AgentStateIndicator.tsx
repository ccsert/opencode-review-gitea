/**
 * AgentStateIndicator — small badge showing current agent state
 *
 * Reads from CopilotKit chat state to display:
 * - Idle (no activity)
 * - Thinking (generating response)
 * - Executing tool (tool call in progress)
 *
 * Guarded: the inner component that calls the CopilotKit hook is only rendered
 * when the user is authenticated (i.e. CopilotKit is mounted). This prevents
 * crashes during logout when CopilotKit is unmounted before the router redirects.
 */

import { useCopilotChat } from "@copilotkit/react-core";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import { Loader2, Bot, Wrench } from "lucide-react";

type AgentState = "idle" | "thinking" | "tool";

/** Inner component — only rendered inside a live CopilotKit context */
function AgentStateIndicatorInner({ className }: { className?: string }) {
  const { isLoading } = useCopilotChat();

  // Derive state — CopilotKit exposes isLoading for active generation
  const state: AgentState = isLoading ? "thinking" : "idle";

  if (state === "idle") return null;

  const config = {
    thinking: {
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: "Thinking…",
      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    tool: {
      icon: <Wrench className="h-3 w-3" />,
      label: "Running tool…",
      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
  }[state];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        config.color,
        className,
      )}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

/**
 * Public wrapper — guards against rendering the CopilotKit hook
 * when the user is not authenticated and CopilotKit is not mounted.
 */
export function AgentStateIndicator({ className }: { className?: string }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return null;
  return <AgentStateIndicatorInner className={className} />;
}

/**
 * Floating badge that sits in the header bar area
 */
export function AgentStatusBadge() {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return null;
  return (
    <div className="flex items-center gap-1.5">
      <Bot className="h-4 w-4 text-muted-foreground" />
      <AgentStateIndicatorInner />
    </div>
  );
}
