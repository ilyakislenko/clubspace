"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  fetchPlatformPlans,
  updatePlatformWorkspaceBilling,
  type PlatformPlansPage,
  type PlatformWorkspace,
  type UpdatePlatformWorkspaceBillingBody,
} from "../../shared/api/platform"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
import {
  formatBytes,
  formatDay,
  STATUS_LABEL,
} from "../billing/billing-view"

const STATUS_CLASS: Record<string, string> = {
  TRIAL: "border-sky-300 bg-sky-50 text-sky-900",
  ACTIVE: "border-emerald-300 bg-emerald-50 text-emerald-900",
  PAST_DUE: "border-amber-300 bg-amber-50 text-amber-900",
  SUSPENDED: "border-destructive/40 bg-destructive/10 text-destructive",
}

const ofMax = (used: number, max: number | null) =>
  max === null ? `${used}` : `${used}/${max}`

// A club's platform plan in the console: summary line plus the manual billing
// actions. Payment is collected outside ClubSpace; «Оплачено» only records it.
export function PlatformWorkspaceBilling({
  workspace,
  onChanged,
}: {
  workspace: PlatformWorkspace
  onChanged: (notice: string) => Promise<void> | void
}) {
  const { billing } = workspace
  const [open, setOpen] = useState(false)
  const [plans, setPlans] = useState<PlatformPlansPage | null>(null)
  const [planId, setPlanId] = useState(billing.plan.planId)
  const [days, setDays] = useState("30")
  const [notes, setNotes] = useState(workspace.billingNotes ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async () => {
    setOpen((v) => !v)
    if (!plans) {
      try {
        setPlans(await fetchPlatformPlans())
      } catch (e) {
        setError(errorMessage(e, "Не удалось загрузить тарифы."))
      }
    }
  }

  const act = async (body: UpdatePlatformWorkspaceBillingBody, done: string) => {
    setBusy(true)
    setError(null)
    try {
      await updatePlatformWorkspaceBilling(workspace.workspaceId, body)
      await onChanged(`«${workspace.name}»: ${done}.`)
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить тариф."))
    } finally {
      setBusy(false)
    }
  }

  const dayCount = Number.parseInt(days, 10)
  const validDays = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 366

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full border px-2 py-0.5 ${STATUS_CLASS[billing.status]}`}>
          {STATUS_LABEL[billing.status]}
        </span>
        <span className="font-medium">{billing.plan.name}</span>
        {billing.status === "TRIAL" && billing.trialEndsAt && (
          <span className="text-muted-foreground">до {formatDay(billing.trialEndsAt)}</span>
        )}
        {billing.status !== "TRIAL" && billing.currentPeriodEnd && (
          <span className="text-muted-foreground">
            оплачено до {formatDay(billing.currentPeriodEnd)}
          </span>
        )}
        {billing.suspendsAt && (
          <span className="text-destructive">пауза {formatDay(billing.suspendsAt)}</span>
        )}
        <span className="text-muted-foreground">
          · участники {ofMax(billing.usage.members, billing.plan.maxMembers)} · тренеры{" "}
          {ofMax(billing.usage.coaches, billing.plan.maxCoaches)} · видео{" "}
          {ofMax(billing.usage.videos, billing.plan.maxVideos)} ·{" "}
          {formatBytes(billing.usage.storageBytes)}
          {billing.plan.maxStorageGb !== null ? ` из ${billing.plan.maxStorageGb} ГБ` : ""}
        </span>
        <Button variant="ghost" size="sm" onClick={toggle}>
          {open ? "Скрыть" : "Тариф"}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 rounded-md bg-muted/50 p-3">
          {plans && !plans.billingEnabled && (
            <p className="text-xs text-amber-900">
              Биллинг выключен (PLATFORM_BILLING_ENABLED=false): лимиты и пауза не
              применяются.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Тариф</span>
              <select
                className={inputClsFull}
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                {(plans?.data ?? [billing.plan]).map((p) => (
                  <option key={p.planId} value={p.planId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              disabled={busy || planId === billing.plan.planId}
              onClick={() => act({ kind: "changePlan", planId }, "тариф изменён")}
            >
              Сменить тариф
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Дней</span>
              <input
                className={`${inputClsFull} w-24`}
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !validDays}
              onClick={() =>
                act({ kind: "markPaid", days: dayCount }, `оплата на ${dayCount} дн. отмечена`)
              }
            >
              Отметить оплату
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !validDays}
              onClick={() =>
                act(
                  { kind: "extendTrial", days: dayCount },
                  `пробный период продлён на ${dayCount} дн.`,
                )
              }
            >
              Продлить пробный период
            </Button>
            {billing.status === "SUSPENDED" ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => act({ kind: "resume" }, "клуб снова работает")}
              >
                Возобновить
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => act({ kind: "suspend" }, "клуб приостановлен")}
              >
                Приостановить
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-64 flex-1 space-y-1">
              <span className="text-xs text-muted-foreground">
                Заметки (счёт, договорённости)
              </span>
              <input
                className={inputClsFull}
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => act({ kind: "setNotes", notes }, "заметки сохранены")}
            >
              Сохранить заметки
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Оплата принимается вне ClubSpace: здесь только отмечается оплаченный
            период. Неоплаченный клуб переходит в «Ожидает оплаты», а после льготного
            периода приостанавливается автоматически.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
