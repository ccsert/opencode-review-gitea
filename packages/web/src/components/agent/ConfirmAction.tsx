/**
 * ConfirmAction — human-in-the-loop confirmation for dangerous agent operations
 *
 * Uses ai-elements Confirmation components for a consistent look.
 * Registers useCopilotAction hooks with `renderAndWaitForResponse` for tools
 * that perform destructive or sensitive actions (delete, configure AI provider).
 */

import { useCopilotAction } from "@copilotkit/react-core";
import { useTranslation } from "react-i18next";
import {
  Confirmation,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from "@/components/ai-elements/confirmation";
import { AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  Trash2,
  Settings,
  Shield,
  Check,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

// Dangerous tools that require explicit user confirmation
const DANGEROUS_TOOLS: Record<
  string,
  { icon: ReactNode; labelKey: string }
> = {
  "delete-template": {
    icon: <Trash2 className="h-4 w-4 text-destructive" />,
    labelKey: "deleteTemplate",
  },
  "delete-webhook": {
    icon: <Trash2 className="h-4 w-4 text-destructive" />,
    labelKey: "deleteWebhook",
  },
  "configure-ai-provider": {
    icon: <Settings className="h-4 w-4 text-amber-500" />,
    labelKey: "configureAI",
  },
};

/**
 * Confirmation UI for a dangerous tool call.
 * Wraps ai-elements Confirmation with CopilotKit's respond pattern.
 */
function ToolConfirmation({
  toolName,
  toolMeta,
  args,
  status,
  onApprove,
  onReject,
}: {
  toolName: string;
  toolMeta: (typeof DANGEROUS_TOOLS)[string];
  args: Record<string, unknown>;
  status: "executing" | "complete" | "inProgress";
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const [responded, setResponded] = useState<"approved" | "rejected" | null>(
    null
  );

  const displayName = toolName
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Map to Confirmation component state
  const confirmState =
    responded === "approved"
      ? ("output-available" as const)
      : responded === "rejected"
        ? ("output-denied" as const)
        : status === "complete"
          ? ("output-available" as const)
          : ("approval-requested" as const);

  const approval = responded
    ? { id: toolName, approved: responded === "approved" }
    : status === "complete"
      ? { id: toolName, approved: true }
      : { id: toolName };

  return (
    <Confirmation
      state={confirmState}
      approval={approval as any}
      className="my-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-4 w-4 text-destructive" />
        </div>
        <div className="flex-1 space-y-2">
          <AlertDescription className="text-sm font-medium">
            {t("agent.confirmAction")}
          </AlertDescription>
          <p className="text-xs text-muted-foreground">
            {t("agent.confirmDescription")}
          </p>

          {/* Tool info */}
          <div className="rounded-md border bg-muted/30 p-2.5 space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              {toolMeta.icon}
              <span className="font-medium">{displayName}</span>
              <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                <Shield className="h-3 w-3" />
                {t("agent.requiresApproval")}
              </span>
            </div>
            {Object.keys(args).length > 0 && (
              <div className="space-y-0.5 text-xs text-muted-foreground">
                {Object.entries(args).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="font-medium min-w-18">{key}:</span>
                    <code className="rounded bg-muted px-1 py-0.5 break-all text-[11px]">
                      {typeof value === "string"
                        ? value.slice(0, 80)
                        : JSON.stringify(value).slice(0, 80)}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </div>

          <ConfirmationRequest>
            <p className="text-xs font-medium text-foreground">
              {t("agent.confirmProceed")}
            </p>
          </ConfirmationRequest>

          <ConfirmationAccepted>
            <div className="flex items-center gap-1.5 text-xs text-green-600">
              <Check className="h-3.5 w-3.5" />
              {t("agent.actionApproved")}
            </div>
          </ConfirmationAccepted>

          <ConfirmationRejected>
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <X className="h-3.5 w-3.5" />
              {t("agent.actionRejected")}
            </div>
          </ConfirmationRejected>
        </div>
      </div>

      <ConfirmationActions>
        <ConfirmationAction
          variant="outline"
          onClick={() => {
            setResponded("rejected");
            onReject();
          }}
        >
          {t("common.cancel")}
        </ConfirmationAction>
        <ConfirmationAction
          variant="destructive"
          onClick={() => {
            setResponded("approved");
            onApprove();
          }}
        >
          {t("common.confirm")}
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
}

/**
 * Registers human-in-the-loop action hooks for all dangerous tools.
 * Must be rendered inside a CopilotKit context.
 */
export function ConfirmAction() {
  useCopilotAction({
    name: "delete-template",
    renderAndWaitForResponse: (props) => {
      if (props.status === "complete") return <></>;
      return (
        <ToolConfirmation
          toolName="delete-template"
          toolMeta={DANGEROUS_TOOLS["delete-template"]}
          args={(props.args ?? {}) as Record<string, unknown>}
          status={props.status}
          onApprove={() => props.respond?.({ approved: true })}
          onReject={() => props.respond?.({ approved: false })}
        />
      );
    },
  });

  useCopilotAction({
    name: "delete-webhook",
    renderAndWaitForResponse: (props) => {
      if (props.status === "complete") return <></>;
      return (
        <ToolConfirmation
          toolName="delete-webhook"
          toolMeta={DANGEROUS_TOOLS["delete-webhook"]}
          args={(props.args ?? {}) as Record<string, unknown>}
          status={props.status}
          onApprove={() => props.respond?.({ approved: true })}
          onReject={() => props.respond?.({ approved: false })}
        />
      );
    },
  });

  useCopilotAction({
    name: "configure-ai-provider",
    renderAndWaitForResponse: (props) => {
      if (props.status === "complete") return <></>;
      return (
        <ToolConfirmation
          toolName="configure-ai-provider"
          toolMeta={DANGEROUS_TOOLS["configure-ai-provider"]}
          args={(props.args ?? {}) as Record<string, unknown>}
          status={props.status}
          onApprove={() => props.respond?.({ approved: true })}
          onReject={() => props.respond?.({ approved: false })}
        />
      );
    },
  });

  return null;
}
