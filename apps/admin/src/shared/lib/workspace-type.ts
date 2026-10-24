// Russian display labels for WorkspaceType values, so no screen shows the raw
// enum (e.g. "GRAPPLING"). Unknown types fall back to the raw value.

const WORKSPACE_TYPE_LABEL_RU: Record<string, string> = {
  GRAPPLING: "Грэпплинг",
  FITNESS: "Фитнес",
  YOGA: "Йога",
  CUSTOM: "Другое",
}

export const workspaceTypeLabel = (type: string): string =>
  WORKSPACE_TYPE_LABEL_RU[type] ?? type
