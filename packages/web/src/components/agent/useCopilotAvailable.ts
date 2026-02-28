/**
 * useCopilotAvailable — safely checks whether a CopilotKit context is mounted
 *
 * Uses a custom React context provided by AgentProvider instead of
 * introspecting CopilotKit internals (which break across versions).
 */

import { createContext, useContext } from "react";

/**
 * Context set to `true` by AgentProvider when CopilotKit is actually mounted.
 * Defaults to `false` so any component outside AgentProvider gets a safe value.
 */
export const CopilotAvailableContext = createContext<boolean>(false);

/**
 * Returns `true` when a `<CopilotKit>` provider is present above this
 * component in the tree.  Safe to call unconditionally — never throws.
 */
export function useCopilotAvailable(): boolean {
  return useContext(CopilotAvailableContext);
}
