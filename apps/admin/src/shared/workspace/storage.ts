const ACTIVE_WORKSPACE_KEY = "activeWorkspaceId"

export const setActiveWorkspaceId = (workspaceId: string): void => {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId)
}

export const clearActiveWorkspaceId = (): void => {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY)
}
