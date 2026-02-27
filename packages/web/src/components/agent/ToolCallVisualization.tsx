/**
 * ToolCallVisualization — renders agent tool calls as informational cards
 *
 * Uses useCopilotAction to register renderers for platform tools.
 * Each tool call shows its name, arguments, and result.
 */

import {
  useCopilotAction,
  type CatchAllActionRenderProps,
} from "@copilotkit/react-core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  GitBranch,
  FileSearch,
  Bot,
  Webhook,
  Settings,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import type { ReactNode } from "react";

// Tool category metadata for display
const TOOL_CATEGORIES: Record<string, { icon: ReactNode; color: string }> = {
  template: {
    icon: <FileText className="h-4 w-4" />,
    color: "bg-blue-500/10 text-blue-600",
  },
  repo: {
    icon: <GitBranch className="h-4 w-4" />,
    color: "bg-green-500/10 text-green-600",
  },
  review: {
    icon: <FileSearch className="h-4 w-4" />,
    color: "bg-purple-500/10 text-purple-600",
  },
  ai: {
    icon: <Bot className="h-4 w-4" />,
    color: "bg-amber-500/10 text-amber-600",
  },
  webhook: {
    icon: <Webhook className="h-4 w-4" />,
    color: "bg-orange-500/10 text-orange-600",
  },
  system: {
    icon: <Settings className="h-4 w-4" />,
    color: "bg-gray-500/10 text-gray-600",
  },
};

function getCategoryForTool(toolName: string): {
  icon: ReactNode;
  color: string;
} {
  if (toolName.includes("template") || toolName.includes("Template")) {
    return TOOL_CATEGORIES.template;
  }
  if (toolName.includes("repo") || toolName.includes("Repo")) {
    return TOOL_CATEGORIES.repo;
  }
  if (toolName.includes("review") || toolName.includes("Review")) {
    return TOOL_CATEGORIES.review;
  }
  if (
    toolName.includes("ai") ||
    toolName.includes("Ai") ||
    toolName.includes("provider")
  ) {
    return TOOL_CATEGORIES.ai;
  }
  if (toolName.includes("webhook") || toolName.includes("Webhook")) {
    return TOOL_CATEGORIES.webhook;
  }
  return TOOL_CATEGORIES.system;
}

function ToolCallCard({
  name,
  status,
  args,
  result,
}: {
  name: string;
  status: "executing" | "complete" | "inProgress";
  args?: Record<string, unknown>;
  result?: unknown;
}) {
  const category = getCategoryForTool(name);
  const displayName = name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/-/g, " ");

  return (
    <Card className="my-2 border-l-4 border-l-primary/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${category.color}`}
          >
            {category.icon}
          </span>
          <span className="flex-1">{displayName}</span>
          {status === "executing" || status === "inProgress" ? (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-green-600">
              <CheckCircle2 className="h-3 w-3" />
              Done
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      {(args || result != null) && (
        <CardContent className="px-4 pb-3 pt-0">
          {args && Object.keys(args).length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Args: </span>
              <code className="rounded bg-muted px-1 py-0.5">
                {JSON.stringify(args, null, 0).slice(0, 200)}
              </code>
            </div>
          )}
          {result != null && status === "complete" && (
            <div className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium">Result: </span>
              <code className="rounded bg-muted px-1 py-0.5">
                {typeof result === "string"
                  ? result.slice(0, 200)
                  : JSON.stringify(result, null, 0).slice(0, 200)}
              </code>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Register a catch-all tool call renderer using useCopilotAction.
 * This component must be rendered inside a CopilotKit context.
 */
export function ToolCallVisualization() {
  // Register a catch-all action renderer for any tool the agent calls
  useCopilotAction({
    name: "*",
    render: (props: CatchAllActionRenderProps) => {
      return (
        <ToolCallCard
          name={props.name}
          status={props.status}
          args={props.args as Record<string, unknown> | undefined}
          result={props.result}
        />
      );
    },
  });

  // This component doesn't render anything itself — it just registers the hook
  return null;
}
