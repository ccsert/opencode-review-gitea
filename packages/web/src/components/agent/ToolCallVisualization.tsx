/**
 * ToolCallVisualization — renders agent tool calls using ai-elements Tool component
 *
 * Uses useCopilotAction to register a catch-all renderer for platform tools.
 * Renders each tool call with a collapsible card showing name, status, args, and result.
 */

import {
  useCopilotAction,
  type CatchAllActionRenderProps,
} from "@copilotkit/react-core";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import type { ToolUIPart } from "ai";

/**
 * Map CopilotKit action status to Vercel AI SDK ToolUIPart state.
 */
function mapStatus(
  status: "executing" | "complete" | "inProgress"
): ToolUIPart["state"] {
  switch (status) {
    case "executing":
      return "input-available";
    case "inProgress":
      return "input-streaming";
    case "complete":
      return "output-available";
    default:
      return "input-available";
  }
}

function formatDisplayName(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/-/g, " ")
    .trim();
}

/**
 * Register a catch-all tool call renderer using useCopilotAction.
 * This component must be rendered inside a CopilotKit context.
 */
export function ToolCallVisualization() {
  useCopilotAction({
    name: "*",
    render: (props: CatchAllActionRenderProps) => {
      const state = mapStatus(props.status);
      const args = (props.args ?? {}) as Record<string, unknown>;
      const hasArgs = Object.keys(args).length > 0;
      const result = props.result;

      return (
        <Tool defaultOpen={state !== "output-available"}>
          <ToolHeader
            title={formatDisplayName(props.name)}
            type="tool-invocation"
            state={state}
          />
          {(hasArgs || result != null) && (
            <ToolContent>
              {hasArgs && <ToolInput input={args} />}
              {result != null && state === "output-available" && (
                <ToolOutput
                  output={
                    typeof result === "string" ? result : result
                  }
                  errorText={undefined}
                />
              )}
            </ToolContent>
          )}
        </Tool>
      );
    },
  });

  return null;
}
