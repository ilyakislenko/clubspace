"use client"

import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  getOnboardingHelp,
  requestOnboardingHelp,
  type OnboardingHelp,
  type OnboardingHelpRequest,
} from "../../shared/api/onboarding-help"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
import { formatPhone } from "../../shared/lib/phone"
import { formatAmount } from "../subscriptions/subscription-display"
import { BANNER_TONE_CLASS, formatDay, type Banner } from "./billing-view"

// What the club is told about its latest request.
const requestBanner = (r: OnboardingHelpRequest): Banner => {
  switch (r.status) {
    case "OPEN":
      return {
        tone: "info",
        text: `Заявка отправлена ${formatDay(r.createdAt)} — команда ClubSpace свяжется с вами.`,
      }
    case "DONE":
      return {
        tone: "success",
        text: `Помощь с подключением оказана${r.resolvedAt ? ` ${formatDay(r.resolvedAt)}` : ""}.${r.resolution ? ` ${r.resolution}` : ""}`,
      }
    case "CANCELED":
      return {
        tone: "warning",
        text: `Заявка отменена${r.resolution ? `: ${r.resolution}` : "."}`,
      }
  }
}

// «Помощь с подключением»: the ClubSpace team sets the club up. A paid service
// covered by the setup fee, which is charged with the first paid period (never
// during the trial) — or waived by the platform. Loads itself.
export function BillingOnboardingHelp({
  workspaceId,
  currency,
}: {
  workspaceId: string
  currency: string
}) {
  const [help, setHelp] = useState<OnboardingHelp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [phone, setPhone] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    getOnboardingHelp({ workspaceId })
      .then((h) => alive && setHelp(h))
      .catch((e) =>
        alive && setError(errorMessage(e, "Не удалось загрузить помощь с подключением.")),
      )
    return () => {
      alive = false
    }
  }, [workspaceId])

  if (!help) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null
  }

  const { request, setupFee } = help
  const open = request?.status === "OPEN"

  const openForm = () => {
    // Editing the open request starts from what was sent.
    setPhone(open ? (request.phone ?? "") : "")
    setMessage(open ? (request.message ?? "") : "")
    setError(null)
    setFormOpen(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const next = await requestOnboardingHelp({
        workspaceId,
        body: {
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(message.trim() ? { message: message.trim() } : {}),
        },
      })
      setHelp(next)
      setFormOpen(false)
    } catch (err) {
      setError(errorMessage(err, "Не удалось отправить заявку."))
    } finally {
      setBusy(false)
    }
  }

  const price = formatAmount(setupFee.amount, currency)
  const status = request ? requestBanner(request) : null

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Помощь с подключением</h2>
        <p className="text-sm text-muted-foreground">
          Команда ClubSpace поможет запустить клуб: настроит разделы и перенесёт
          данные. Это платная услуга — её покрывает плата за подключение.
        </p>
        <p className="text-sm">
          {setupFee.state === "WAIVED" ? (
            <span className="text-emerald-700">Бесплатно для вашего клуба.</span>
          ) : setupFee.state === "PAID" ? (
            `Стоимость — ${price}, оплачено.`
          ) : (
            `Стоимость — ${price}. Спишется вместе с первым оплаченным периодом, в пробный период ничего не списывается.`
          )}
        </p>
      </div>

      {status && (
        <div className={`space-y-1 rounded-md border px-3 py-2 text-sm ${BANNER_TONE_CLASS[status.tone]}`}>
          <p>{status.text}</p>
          {open && (request.phone || request.message) && (
            <p className="text-xs">
              {request.phone ? `Телефон: ${formatPhone(request.phone)}` : ""}
              {request.phone && request.message ? " · " : ""}
              {request.message ?? ""}
            </p>
          )}
        </div>
      )}

      {formOpen ? (
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <label className="block space-y-1">
            <span className="block text-xs text-muted-foreground">Телефон для связи</span>
            <input
              className={`${inputClsFull} max-w-xs`}
              type="tel"
              value={phone}
              maxLength={32}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 900 000-00-00"
            />
          </label>
          <label className="block space-y-1">
            <span className="block text-xs text-muted-foreground">
              С чем помочь (необязательно)
            </span>
            <textarea
              className={inputClsFull}
              rows={3}
              value={message}
              maxLength={2000}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {open ? "Сохранить заявку" : "Отправить заявку"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setFormOpen(false)}
            >
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant={open ? "ghost" : "secondary"} onClick={openForm}>
          {open ? "Изменить заявку" : "Запросить помощь с подключением"}
        </Button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
