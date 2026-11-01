"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  lockPlatformWorkspaceFeature,
  setPlatformWorkspaceFeature,
  unlockPlatformWorkspaceFeature,
  type PlatformWorkspaceBillingCard,
} from "../../shared/api/platform"
import { inputClsFull } from "../../shared/lib/input-class"
import { formatDay } from "../billing/billing-view"
import { APP_SECTIONS, type AppSectionFeature } from "../settings/app-sections"

// The club's app sections in the console card: the platform flips a switch,
// and can pin it («Закрепить») so the club's admin cannot change it — until
// the optional date, or until «Снять». A locked switch keeps following the
// platform's checkbox.
export function PlatformAppSections({
  workspaceId,
  card,
  busy,
  run,
}: {
  workspaceId: string
  card: PlatformWorkspaceBillingCard
  busy: boolean
  run: (call: () => Promise<PlatformWorkspaceBillingCard>, done: string) => Promise<void>
}) {
  const [until, setUntil] = useState("")
  const videoEntitled =
    card.billing.modules.find((m) => m.code === "VIDEO")?.entitled ?? false

  const setFeature = (feature: AppSectionFeature, label: string, enabled: boolean) =>
    run(
      () => setPlatformWorkspaceFeature(workspaceId, { feature, enabled }),
      `раздел «${label}» ${enabled ? "включён" : "выключен"}`,
    )

  const lock = (feature: AppSectionFeature, label: string, enabled: boolean) =>
    run(
      () =>
        lockPlatformWorkspaceFeature(workspaceId, {
          feature,
          enabled,
          until: until || null,
        }),
      `раздел «${label}» закреплён ${enabled ? "включённым" : "выключенным"}${
        until ? ` до ${formatDay(until)}` : ""
      }`,
    )

  const unlock = (feature: AppSectionFeature, label: string) =>
    run(
      () => unlockPlatformWorkspaceFeature(workspaceId, feature),
      `раздел «${label}» снова под управлением клуба`,
    )

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          Разделы приложения клуба
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Закреплять до (необязательно)</span>
          <input
            type="date"
            className={`${inputClsFull} w-40`}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
      </div>
      <ul className="divide-y rounded-md border bg-card">
        {APP_SECTIONS.map((s) => {
          const on = card.features[s.feature]
          const needsVideo = s.feature === "videos" && !videoEntitled && !on
          const pinned = card.featureLocks.find((l) => l.feature === s.feature)
          return (
            <li key={s.feature} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              <label className="flex min-w-48 flex-1 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy || needsVideo}
                  onChange={(e) => void setFeature(s.feature, s.label, e.target.checked)}
                />
                <span>{s.label}</span>
                {needsVideo && (
                  <span className="text-xs text-muted-foreground">(нужен модуль «Видео»)</span>
                )}
              </label>
              {pinned ? (
                <>
                  <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs text-sky-900">
                    Закреплено {pinned.enabled ? "вкл" : "выкл"}
                    {pinned.until ? ` до ${formatDay(pinned.until)}` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void unlock(s.feature, s.label)}
                  >
                    Снять
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || needsVideo}
                  onClick={() => void lock(s.feature, s.label, on)}
                >
                  Закрепить
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Закреплённый раздел клуб видит выключателем «Установлено платформой» и не может
        его изменить.
      </p>
    </section>
  )
}
