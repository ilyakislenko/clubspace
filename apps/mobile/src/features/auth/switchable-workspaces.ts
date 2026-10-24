import type { WorkspaceSummary } from "../../shared/api/workspaces"

// Clubs the member can jump to from the lock screen: every other club whose
// access is still live. Pure so the rule is unit-testable.
export const switchableWorkspaces = (
  list: WorkspaceSummary[],
  currentId: string | null | undefined,
): WorkspaceSummary[] =>
  list.filter((w) => w.workspaceId !== currentId && !w.accessExpired)

export const displayName = (
  me: { firstname?: string | null; lastname?: string | null } | null,
): string => [me?.firstname, me?.lastname].filter(Boolean).join(" ").trim()
