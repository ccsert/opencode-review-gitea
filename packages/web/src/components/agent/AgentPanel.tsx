/**
 * AgentPanel — sliding sidebar panel for chatting with the platform agent
 *
 * Wraps CopilotSidebar from @copilotkit/react-ui and registers the
 * ToolCallVisualization component for rendering tool call cards inline,
 * plus ConfirmAction for human-in-the-loop on dangerous operations.
 */

import "@copilotkit/react-ui/styles.css";

import { useState } from "react";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { useTranslation } from "react-i18next";
import { Bot, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ToolCallVisualization } from "./ToolCallVisualization";
import { AgentStateIndicator } from "./AgentStateIndicator";
import { ConfirmAction } from "./ConfirmAction";

export function AgentPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Register tool call renderer inside CopilotKit context */}
      <ToolCallVisualization />
      {/* Register human-in-the-loop confirmation for dangerous operations */}
      <ConfirmAction />

      {/* Floating trigger button — fixed bottom-right */}
      <Button
        variant="default"
        size="icon"
        className={cn(
          "fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg transition-transform hover:scale-105",
          open && "scale-0 opacity-0 pointer-events-none",
        )}
        onClick={() => setOpen(true)}
        aria-label={t("agent.openChat")}
      >
        <Bot className="h-5 w-5" />
      </Button>

      {/* Sidebar chat panel */}
      {open && (
        <div className="fixed inset-y-0 right-0 z-50 w-[420px] max-w-full border-l bg-background shadow-xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm">{t("agent.title")}</span>
              <AgentStateIndicator />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setOpen(false)}
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* CopilotSidebar fills remaining space */}
          <div className="flex-1 overflow-hidden">
            <CopilotSidebar
              defaultOpen={true}
              clickOutsideToClose={false}
              labels={{
                title: t("agent.title"),
                initial: t("agent.welcomeMessage"),
                placeholder: t("agent.inputPlaceholder"),
              }}
              className="h-full border-0 shadow-none"
            />
          </div>
        </div>
      )}
    </>
  );
}
