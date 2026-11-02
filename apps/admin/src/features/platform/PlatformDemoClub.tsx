"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  fetchPlatformDemoClub,
  resetPlatformDemoClub,
  type PlatformDemoClub as DemoClub,
  type PlatformDemoClubId,
} from "../../shared/api/platform"
import { errorMessage } from "../../shared/lib/error-message"
import { formatShortDate } from "../billing/billing-view"

const ABOUT: Record<PlatformDemoClubId, string> = {
  academy: "«ACADEMY» — клуб единоборств (Томск + Северск)",
  ritm: "«Ритм» — танцевальная студия: занятия, педагоги, мастер-классы с записью",
}

// One in-person demo club (docs/demo.md): who to sign in as on the Mac and the
// phones, the fixed code, and «Сбросить демо» — wipes ONLY this demo club and
// builds it again with dates shifted to today; the other demo club and every
// real club stay as they are. Loads itself.
export function PlatformDemoClub({
  club,
  onChanged,
}: {
  club: PlatformDemoClubId
  onChanged: (notice: string) => Promise<void> | void
}) {
  const [demo, setDemo] = useState<DemoClub | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setDemo(await fetchPlatformDemoClub(club))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить демо-клуб."))
    }
  }, [club])

  useEffect(() => {
    void load()
  }, [load])

  const reset = async () => {
    if (
      !window.confirm(
        `Сбросить демо-клуб ${demo?.name ?? ""}? Все изменения в нём пропадут, клуб будет создан заново с сегодняшними датами. Другие клубы, в том числе второй демо-клуб, не затрагиваются.`,
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await resetPlatformDemoClub(club)
      await load()
      await onChanged(
        `${demo?.name ?? "Демо-клуб"} пересоздан за ${(r.durationMs / 1000).toFixed(1)} с: ${r.counts.members} участников, ${r.counts.groups} групп, ${r.counts.visits} посещений, ${r.counts.subscriptions} абонементов.`,
      )
    } catch (e) {
      setError(errorMessage(e, "Не удалось сбросить демо-клуб."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Демо-клуб {demo?.name ?? ""}</h2>
          <p className="text-sm text-muted-foreground">
            {ABOUT[club]}. Сценарий и подготовка — в docs/demo.md. Сбросьте перед каждой встречей.
          </p>
        </div>
        <Button disabled={busy || !demo?.enabled} onClick={() => void reset()}>
          {busy ? "Сбрасываем…" : "Сбросить демо"}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {demo === null ? (
        !error && <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : (
        <div className="space-y-3 rounded-md border p-3 text-sm">
          {!demo.enabled && (
            <p className="text-muted-foreground">
              Демо-режим выключен. Чтобы включить вход по постоянному коду и сброс, задайте на
              сервере DEMO_MODE=true, DEMO_WORKSPACE_KEY={demo.workspaceKey} и DEMO_LOGIN_CODE
              (6 цифр) и перезапустите его.
            </p>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              Клуб:{" "}
              <span className="font-medium">
                {demo.workspace ? demo.workspace.name : "ещё не создан — нажмите «Сбросить демо»"}
              </span>
            </span>
            {demo.workspace?.joinCode && (
              <span>
                Код клуба: <span className="font-mono font-medium">{demo.workspace.joinCode}</span>
              </span>
            )}
            {demo.loginCode && (
              <span>
                Код входа для всех аккаунтов:{" "}
                <span className="font-mono text-base font-semibold">{demo.loginCode}</span>
              </span>
            )}
            <span className="text-muted-foreground">
              Последний сброс: {demo.lastResetAt ? formatShortDate(demo.lastResetAt) : "не было"}
            </span>
          </div>
          <ul className="divide-y rounded-md border">
            {demo.accounts.map((a) => (
              <li key={a.email ?? a.name} className="space-y-0.5 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">{a.roleLabel}</span>
                  <span>{a.name}</span>
                  <span className="font-mono text-xs">
                    {a.email ?? `через ${a.via} → «Я / ребёнок»`}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{a.summary}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
