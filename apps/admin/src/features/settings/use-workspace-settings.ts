"use client"

import { useCallback, useEffect, useState } from "react"

import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
  type WorkspaceSettings,
  type WorkspaceSettingsPatch,
} from "../../shared/api/workspaces"
import { errorMessage } from "../../shared/lib/error-message"
import { isStaleUpdate } from "../../shared/ui/stale-update-notice"

// The club's settings for one settings section: load once, then patch field
// by field. The PATCH answer lacks the read-only fields (entitlement, platform
// pins), so they are kept from the GET. Each patch carries the `updatedAt` it
// was based on; a 409 (someone saved the club in between) sets `stale` until
// `reload`.
export function useWorkspaceSettings(workspaceId: string | undefined) {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setError(null)
    setStale(null)
    getWorkspaceSettings({ workspaceId })
      .then((data) => {
        if (!cancelled) setSettings(data)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadFailed(true)
        setError(errorMessage(err, "Не удалось загрузить настройки"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, reloadKey])

  const updatedAt = settings?.updatedAt
  const save = useCallback(
    async (patch: WorkspaceSettingsPatch, failText = "Не удалось сохранить") => {
      if (!workspaceId) return false
      setSaving(true)
      setError(null)
      setStale(null)
      try {
        const updated = await updateWorkspaceSettings({
          workspaceId,
          ...patch,
          expectedUpdatedAt: updatedAt,
        })
        setSettings((prev) => (prev ? { ...prev, ...updated } : updated))
        return true
      } catch (err) {
        if (isStaleUpdate(err)) setStale(err)
        else setError(errorMessage(err, failText))
        return false
      } finally {
        setSaving(false)
      }
    },
    [workspaceId, updatedAt],
  )

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  return { settings, loading, loadFailed, saving, error, stale, save, reload }
}
