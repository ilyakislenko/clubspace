// Russian display labels for WorkspaceType values, so no screen shows the raw
// enum (e.g. "GRAPPLING"). Unknown types fall back to the raw value.

const WORKSPACE_TYPE_LABEL_RU: Record<string, string> = {
  GRAPPLING: "Грэпплинг",
  FITNESS: "Фитнес",
  YOGA: "Йога",
  DANCE: "Танцы",
  CUSTOM: "Другое",
}

export const workspaceTypeLabel = (type: string): string =>
  WORKSPACE_TYPE_LABEL_RU[type] ?? type

// «Чем занимаетесь» when a club is created (sign-up and the platform console).
// Mirrors the server's WorkspaceType enum. Deliberately not BJJ-only: the
// platform is multi-discipline and a creator picks what their club actually
// is — the type sets the club's starting app sections.
export const WORKSPACE_TYPE_OPTIONS = [
  { value: "GRAPPLING", label: "Единоборства / грэпплинг" },
  { value: "FITNESS", label: "Фитнес" },
  { value: "YOGA", label: "Йога" },
  { value: "DANCE", label: "Танцы" },
  { value: "CUSTOM", label: "Другое" },
] as const

export type WorkspaceTypeValue = (typeof WORKSPACE_TYPE_OPTIONS)[number]["value"]
