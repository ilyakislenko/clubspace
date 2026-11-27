"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { getAiChatState, type AiChatState } from "../../../../../shared/api/ai-chat"
import { getWorkspaceBilling, type WorkspaceBillingPage } from "../../../../../shared/api/billing"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { clubLimitRows } from "../../../../../features/billing/billing-view"
import { UsageMeter } from "../../../../../features/billing/UsageMeter"

// «Лимиты»: every quota the club has and how much of it is used, on one card.
export default function WorkspaceLimitsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId ?? ""
  const [data, setData] = useState<{
    billing: WorkspaceBillingPage
    ai: AiChatState | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!workspaceId) return
    let alive = true
    setError(null)
    Promise.all([
      getWorkspaceBilling({ workspaceId }),
      // The AI quota is an optional extra: if its request fails, only that
      // row is dropped so the owner still sees the club's other limits.
      getAiChatState({ workspaceId }).catch(() => null),
    ])
      .then(([billing, ai]) => alive && setData({ billing, ai }))
      .catch((e) => alive && setError(errorMessage(e, "Не удалось загрузить лимиты клуба.")))
    return () => {
      alive = false
    }
  }, [workspaceId, attempt])

  if (error) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
        <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          Повторить
        </Button>
      </div>
    )
  }
  if (!data) {
    return <div className="text-sm text-muted-foreground">Загрузка…</div>
  }

  const billing = data.billing.enabled ? data.billing.billing : null
  const rows = clubLimitRows(billing, data.ai)
  const videoEntitled = billing?.modules.some((m) => m.code === "VIDEO" && m.entitled) ?? false
  const footnote = billing?.trial.limited
    ? "Оплатите подписку ClubSpace, чтобы снять ограничение."
    : videoEntitled
      ? "Сверх лимита видео оплачивается в следующем счёте."
      : null

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Лимиты</h1>

      <div className="space-y-2">
        <section className="space-y-4 rounded-lg border bg-card p-4">
          {rows.map((row) => (
            <UsageMeter
              key={row.label}
              label={row.label}
              usedLabel={row.usedLabel}
              percent={row.percent}
              tone={row.neutral ? "neutral" : "cap"}
            />
          ))}
          {!billing ? (
            <p className="text-sm text-muted-foreground">
              На этой установке ClubSpace лимитов по тарифу нет.
            </p>
          ) : (
            rows.length === 0 && (
              <p className="text-sm text-muted-foreground">У клуба сейчас нет лимитов.</p>
            )
          )}
        </section>
        {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
      </div>
    </div>
  )
}
