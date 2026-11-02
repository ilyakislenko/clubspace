"use client"

import { useEffect, useState } from "react"

import { fetchWorkspaces, type WorkspaceSummary } from "../api/workspaces"

export type WorkspaceFeatures = WorkspaceSummary["features"]
export type WorkspaceFeature = keyof WorkspaceFeatures

// The club's app sections (ranks, video, …) as switched in its settings.
// Re-read whenever `refreshKey` changes (the sidebar passes the path, so a
// section switched off leaves the menu on the next page). null until loaded
// or when the lookup failed: callers then show everything — the server still
// guards each page.
export const useWorkspaceFeatures = (
  workspaceId: string | undefined,
  refreshKey?: unknown,
): WorkspaceFeatures | null => {
  const [features, setFeatures] = useState<WorkspaceFeatures | null>(null)
  useEffect(() => {
    if (!workspaceId) return
    let alive = true
    fetchWorkspaces({ perPage: 100 })
      .then((list) => {
        if (!alive) return
        setFeatures(list.find((w) => w.workspaceId === workspaceId)?.features ?? null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [workspaceId, refreshKey])
  return features
}

// A section shows unless the club is known to have it switched off.
export const featureOn = (
  features: WorkspaceFeatures | null,
  feature: WorkspaceFeature,
): boolean => !features || features[feature]
