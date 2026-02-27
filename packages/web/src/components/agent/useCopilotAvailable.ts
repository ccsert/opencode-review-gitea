/**
 * useCopilotAvailable — safely checks whether a CopilotKit context is mounted
 *
 * CopilotKit throws when hooks are called outside its provider. This hook
 * reads the raw React context to detect whether the provider is present,
 * without triggering the throw.
 */

import { useContext } from "react";
import { CopilotContext } from "@copilotkit/react-core";

/**
 * Returns `true` when a `<CopilotKit>` provider is present above this
 * component in the tree.  Safe to call unconditionally — never throws.
 */
export function useCopilotAvailable(): boolean {
  const ctx = useContext(CopilotContext);

  // CopilotKit sets the default context to a sentinel object and throws in
  // `useCopilotContext` when the value is still that sentinel.  We detect
  // the sentinel by checking for a property that the real provider always
  // sets (copilotApiConfig is populated by <CopilotKit>).
  if (!ctx || !ctx.copilotApiConfig) return false;

  // The real provider sets chatComponentsCache to a Map instance.
  // The sentinel has it as `undefined` or an empty object.
  return true;
}
