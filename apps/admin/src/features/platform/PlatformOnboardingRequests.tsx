"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  fetchPlatformOnboardingRequests,
  updatePlatformOnboardingRequest,
  type OnboardingRequestStatus,
  type PlatformOnboardingRequest,
} from "../../shared/api/platform"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
import { formatPhone } from "../../shared/lib/phone"
import { formatAmount } from "../subscriptions/subscription-display"
import { formatShortDate } from "../billing/billing-view"
import { ONBOARDING_STATUS_LABEL } from "./PlatformAuditFeed"

const STATUS_FILTERS: Array<{ value: OnboardingRequestStatus | ""; label: string }> = [
  { value: "OPEN", label: "Открытые" },
  { value: "DONE", label: "Выполненные" },
  { value: "CANCELED", label: "Отменённые" },
  { value: "", label: "Все" },
]

const SETUP_FEE_LABEL: Record<PlatformOnboardingRequest["setupFee"]["state"], string> = {
  DUE: "к оплате с первым периодом",
  PAID: "оплачено",
  WAIVED: "не берётся",
}

// Clubs' «помощь с подключением» requests: who asked, how to reach them, and
// where the setup fee (which pays for the help) stands. «Готово» / «Отменить»
// close a request with an optional note the club sees. Loads itself.
export function PlatformOnboardingRequests({
  onShowClub,
  onChanged,
}: {
  // Narrows the clubs list below to this club, where its card is.
  onShowClub: (workspaceName: string) => void
  onChanged: (notice: string) => Promise<void> | void
}) {
  const [status, setStatus] = useState<OnboardingRequestStatus | "">("OPEN")
  const [requests, setRequests] = useState<PlatformOnboardingRequest[] | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRequests((await fetchPlatformOnboardingRequests(status || undefined)).data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить заявки на помощь с подключением."))
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const resolve = async (r: PlatformOnboardingRequest, next: "DONE" | "CANCELED") => {
    const resolution = (notes[r.id] ?? "").trim()
    setBusyId(r.id)
    setError(null)
    try {
      await updatePlatformOnboardingRequest(r.id, {
        status: next,
        ...(resolution ? { resolution } : {}),
      })
      setNotes((all) => ({ ...all, [r.id]: "" }))
      await load()
      await onChanged(
        `«${r.workspaceName}»: заявка на помощь с подключением ${next === "DONE" ? "выполнена" : "отменена"}.`,
      )
    } catch (e) {
      setError(errorMessage(e, "Не удалось обновить заявку."))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Помощь с подключением</h2>
          <p className="text-sm text-muted-foreground">
            Заявки клубов. Услуга платная — её покрывает плата за подключение.
            Отменить плату за подключение — промо «Без платы за подключение» в
            карточке клуба.
          </p>
        </div>
        <select
          className={`${inputClsFull} w-40`}
          value={status}
          aria-label="Статус заявки"
          onChange={(e) => setStatus(e.target.value as OnboardingRequestStatus | "")}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {requests === null ? (
        !error && <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : requests.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {status === "OPEN" ? "Открытых заявок нет." : "Заявок нет."}
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {requests.map((r) => (
            <li key={r.id} className="space-y-2 px-3 py-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <button
                  type="button"
                  className="font-medium underline-offset-4 hover:underline"
                  title="Показать клуб в списке"
                  onClick={() => onShowClub(r.workspaceName)}
                >
                  {r.workspaceName}
                </button>
                {status === "" && (
                  <span className="rounded-full border px-2 py-0.5 text-xs">
                    {ONBOARDING_STATUS_LABEL[r.status]}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatShortDate(r.createdAt)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Подключение {formatAmount(r.setupFee.amount, "RUB")}:{" "}
                  {SETUP_FEE_LABEL[r.setupFee.state]}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {r.requesterName}
                {r.requesterEmail ? ` · ${r.requesterEmail}` : ""}
                {r.phone ? ` · ${formatPhone(r.phone)}` : ""}
              </div>
              {r.message && <p className="whitespace-pre-line">{r.message}</p>}
              {r.status !== "OPEN" && (r.resolution || r.resolvedAt) && (
                <p className="text-xs text-muted-foreground">
                  {r.resolvedAt ? `Закрыта ${formatShortDate(r.resolvedAt)}` : "Закрыта"}
                  {r.resolution ? ` · ${r.resolution}` : ""}
                </p>
              )}
              {r.status === "OPEN" && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${inputClsFull} max-w-sm`}
                    value={notes[r.id] ?? ""}
                    maxLength={2000}
                    placeholder="Комментарий для клуба (необязательно)"
                    onChange={(e) => setNotes((all) => ({ ...all, [r.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId !== null}
                    onClick={() => void resolve(r, "DONE")}
                  >
                    Готово
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId !== null}
                    onClick={() => void resolve(r, "CANCELED")}
                  >
                    Отменить
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
