/**
 * ConfirmAction — human-in-the-loop confirmation for dangerous agent operations
 *
 * Registers useCopilotAction hooks with `renderAndWaitForResponse` for tools
 * that perform destructive or sensitive actions (delete, configure AI provider).
 * Each hook pauses tool execution until the user explicitly approves or rejects.
 */

import { useCopilotAction } from "@copilotkit/react-core";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Trash2, Settings, Shield } from "lucide-react";
import type { ReactNode } from "react";

// Dangerous tools that require explicit user confirmation before execution
const DANGEROUS_TOOLS: Record<
  string,
  { icon: ReactNode; variant: "destructive" | "default"; labelKey: string }
> = {
  "delete-template": {
    icon: <Trash2 className="h-5 w-5 text-destructive" />,
    variant: "destructive",
    labelKey: "deleteTemplate",
  },
  "delete-webhook": {
    icon: <Trash2 className="h-5 w-5 text-destructive" />,
    variant: "destructive",
    labelKey: "deleteWebhook",
  },
  "configure-ai-provider": {
    icon: <Settings className="h-5 w-5 text-amber-500" />,
    variant: "default",
    labelKey: "configureAI",
  },
};

/**
 * Renders a confirmation dialog for a dangerous tool call.
 * Returns JSX that blocks agent execution until the user responds.
 */
function ConfirmationDialog({
  toolName,
  toolMeta,
  args,
  isExecuting,
  onApprove,
  onReject,
}: {
  toolName: string;
  toolMeta: (typeof DANGEROUS_TOOLS)[string];
  args: Record<string, unknown>;
  isExecuting: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();

  const displayName = toolName
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <AlertDialogTitle className="text-base">
              {t("agent.confirmAction")}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>{t("agent.confirmDescription")}</p>

              {/* Tool info card */}
              <div className="rounded-md border bg-muted/50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {toolMeta.icon}
                  <span className="font-medium text-sm text-foreground">
                    {displayName}
                  </span>
                  <Badge variant="outline" className="ml-auto text-xs">
                    <Shield className="mr-1 h-3 w-3" />
                    {t("agent.requiresApproval")}
                  </Badge>
                </div>

                {/* Show relevant args */}
                {Object.keys(args).length > 0 && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {Object.entries(args).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="font-medium min-w-[80px]">{key}:</span>
                        <code className="rounded bg-muted px-1 py-0.5 break-all">
                          {typeof value === "string"
                            ? value.slice(0, 100)
                            : JSON.stringify(value, null, 0).slice(0, 100)}
                        </code>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-sm font-medium">{t("agent.confirmProceed")}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onReject} disabled={!isExecuting}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onApprove}
            variant={toolMeta.variant}
            disabled={!isExecuting}
          >
            {t("common.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Registers human-in-the-loop action hooks for all dangerous tools.
 * Must be rendered inside a CopilotKit context.
 */
export function ConfirmAction() {
  // Register a renderAndWaitForResponse hook for each dangerous tool.
  // When the agent calls one of these tools, execution pauses and the
  // confirmation dialog is shown. The agent resumes only after the user
  // clicks Approve or Reject.

  useCopilotAction({
    name: "delete-template",
    renderAndWaitForResponse: (props) => {
      if (props.status === "complete") return <></>;
      return (
        <ConfirmationDialog
          toolName="delete-template"
          toolMeta={DANGEROUS_TOOLS["delete-template"]}
          args={(props.args ?? {}) as Record<string, unknown>}
          isExecuting={props.status === "executing"}
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
        <ConfirmationDialog
          toolName="delete-webhook"
          toolMeta={DANGEROUS_TOOLS["delete-webhook"]}
          args={(props.args ?? {}) as Record<string, unknown>}
          isExecuting={props.status === "executing"}
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
        <ConfirmationDialog
          toolName="configure-ai-provider"
          toolMeta={DANGEROUS_TOOLS["configure-ai-provider"]}
          args={(props.args ?? {}) as Record<string, unknown>}
          isExecuting={props.status === "executing"}
          onApprove={() => props.respond?.({ approved: true })}
          onReject={() => props.respond?.({ approved: false })}
        />
      );
    },
  });

  // This component only registers hooks — it doesn't render anything itself
  return null;
}
