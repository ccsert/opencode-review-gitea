/**
 * AgentProvider — wraps the app with CopilotKit runtime context
 *
 * Injects auth token from Zustand store into CopilotKit headers so the
 * backend /api/v1/agui endpoint can authenticate the user.
 */

import { CopilotKit } from "@copilotkit/react-core";
import { useAuthStore } from "@/stores/auth";

interface AgentProviderProps {
  children: React.ReactNode;
}

export function AgentProvider({ children }: AgentProviderProps) {
  const { accessToken } = useAuthStore();

  return (
    <CopilotKit
      runtimeUrl="/api/v1/agui"
      headers={
        accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
      }
    >
      {children}
    </CopilotKit>
  );
}
