/**
 * AgentProvider — wraps the app with CopilotKit runtime context
 *
 * Injects auth token from Zustand store into CopilotKit headers so the
 * backend /api/v1/agui endpoint can authenticate the user.
 *
 * CopilotKit is only mounted when the user is authenticated to avoid
 * unauthenticated requests to /api/v1/agui on app startup.
 */

import { CopilotKit } from "@copilotkit/react-core";
import { useAuthStore } from "@/stores/auth";

interface AgentProviderProps {
  children: React.ReactNode;
}

export function AgentProvider({ children }: AgentProviderProps) {
  const { accessToken, isAuthenticated } = useAuthStore();

  // Only mount CopilotKit when authenticated — prevents 401 on startup
  if (!isAuthenticated || !accessToken) {
    return <>{children}</>;
  }

  return (
    <CopilotKit
      runtimeUrl="/api/v1/agui"
      agent="platform-agent"
      headers={{ Authorization: `Bearer ${accessToken}` }}
    >
      {children}
    </CopilotKit>
  );
}
