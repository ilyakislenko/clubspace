"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "../../../../../shared/api/notification-preferences"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { isWorkspaceAdmin } from "../../../../../shared/lib/permissions"
import { useMyMembership } from "../../../../../shared/lib/use-my-membership"
import { analyticsSections } from "./sections"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { cap } from "@clubspace/ui-kit/brand"

export default function AnalyticsOverviewPage() {
  const params = useParams<{ workspaceId: string }>()
  const vocabulary = useVocabulary()
  const workspaceId = params?.workspaceId
  const canAdmin = isWorkspaceAdmin(useMyMembership(workspaceId))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Аналитика</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Кто может уйти, как держатся новички, где пустые залы и чего ждать по
          деньгам. {cap(vocabulary.coach.nomPl)} видят цифры только по своим группам.
        </p>
      </div>

      {canAdmin && <DigestToggle />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {analyticsSections(vocabulary).map((s) => (
          <Link
            key={s.path}
            href={`/workspace/${workspaceId}/analytics/${s.path}`}
            className="block space-y-2 rounded-lg border border-border bg-card p-4 transition hover:opacity-90"
          >
            <div className="flex items-center gap-2 font-medium">
              <s.icon className="size-4 text-primary" />
              {s.title}
            </div>
            <p className="text-sm text-muted-foreground">{s.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

// The Monday «Аналитика за неделю» push + e-mail. A personal preference, so it
// follows the user across every club they run.
function DigestToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getNotificationPreferences()
      .then((p) => setEnabled(p.analyticsDigestEnabled))
      .catch((err) =>
        setError(errorMessage(err, "Не удалось загрузить настройку сводки.")),
      )
  }, [])

  const toggle = async (next: boolean) => {
    setSaving(true)
    setError(null)
    setEnabled(next)
    try {
      const p = await updateNotificationPreferences({
        analyticsDigestEnabled: next,
      })
      setEnabled(p.analyticsDigestEnabled)
    } catch (err) {
      setEnabled(!next)
      setError(errorMessage(err, "Не удалось сохранить настройку."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1 rounded-lg border border-border bg-card p-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled ?? false}
          disabled={enabled === null || saving}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Еженедельная сводка на почту и в push
      </label>
      <p className="text-xs text-muted-foreground">
        По понедельникам в 9:00: три факта и три действия по клубу.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
