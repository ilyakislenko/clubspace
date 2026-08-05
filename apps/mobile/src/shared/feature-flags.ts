import type { WorkspaceSummary } from "./api/workspaces"

// The app-section flags the workspace carries (announcements, ranks, …). Keys
// come straight from the typed contract so this stays in sync with the server.
export type AppFeatureKey = keyof NonNullable<WorkspaceSummary["features"]>

/**
 * Whether an app section should be shown for the active workspace. Defaults to
 * ENABLED when the flag is missing — an older cached workspace, or a payload
 * that predates this feature, must never hide a section by accident.
 */
export const isFeatureEnabled = (
  workspace: WorkspaceSummary | null | undefined,
  key: AppFeatureKey,
): boolean => workspace?.features?.[key] !== false
