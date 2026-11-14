"use client"

import { Button } from "@clubspace/ui-kit/ui"

// Loading placeholder and error line of a settings section; renders nothing
// once the settings are in and the last save went through.
export function SettingsLoadState({
  loading,
  loadFailed,
  error,
  onRetry,
}: {
  loading: boolean
  loadFailed: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return <div className="h-32 animate-pulse rounded-xl border border-border bg-muted" />
  }
  if (!error) return null
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
      {loadFailed && (
        <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  )
}
