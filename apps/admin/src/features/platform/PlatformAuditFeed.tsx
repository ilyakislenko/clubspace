"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  fetchPlatformAudit,
  type PlatformAuditEvent,
} from "../../shared/api/platform"
import { errorMessage } from "../../shared/lib/error-message"
import {
  formatShortDate,
  STATUS_LABEL,
  type BillingStatus,
} from "../billing/billing-view"
import { APP_SECTIONS } from "../settings/app-sections"

const PER_PAGE = 20

const ACTION_LABEL: Record<string, string> = {
  "workspace.create": "Клуб создан",
  "workspace.update": "Клуб изменён",
  "workspace.transferOwner": "Клуб передан",
  "workspace.billingUpdate": "Тариф клуба изменён",
  "workspace.billingExpire": "Оплата клуба просрочена",
  "workspace.moduleUpdate": "Модуль",
  "workspace.forceFeature": "Раздел клуба",
  "auth.storeReviewSignIn": "Вход аккаунта для проверки магазина приложений",
  "member.grantStoreReviewAccess":
    "Аккаунт проверки магазина добавлен в демо-клуб",
}

const BILLING_KIND_LABEL: Record<string, string> = {
  extendTrial: "Тариф: пробный период продлён",
  markPaid: "Тариф: оплата отмечена",
  extendPeriod: "Тариф: оплаченный период продлён",
  suspend: "Тариф: клуб приостановлен",
  resume: "Тариф: клуб возобновлён",
  setNotes: "Тариф: заметки",
  setCustomPrice: "Тариф: своя цена",
  setDiscount: "Тариф: скидка",
  setFreeUntil: "Тариф: бесплатный период",
  setSetupFeeWaived: "Тариф: плата за подключение",
  setBillingPeriod: "Тариф: период оплаты",
}

const BILLING_FIELD_LABEL: Record<string, string> = {
  status: "статус",
  trialEndsAt: "пробный до",
  currentPeriodEnd: "оплачено до",
  pastDueSince: "просрочка с",
  suspendsAt: "пауза",
  notes: "заметки",
  customMonthlyPrice: "цена в месяц",
  discountPercent: "скидка, %",
  freeUntil: "бесплатно до",
  setupFeeWaived: "без платы за подключение",
  billingPeriodMonths: "период, мес",
}

// Module names for the feed: the event carries only the code.
const MODULE_LABEL: Record<string, string> = {
  VIDEO: "Видео",
  ONLINE_PAYMENTS: "Онлайн-оплата",
  BRANDED_APP: "Приложение под брендом клуба",
}

export const MODULE_MODE_LABEL: Record<string, string> = {
  DEFAULT: "По умолчанию",
  PAID: "Оплачен",
  COMP: "Бесплатно",
  OFF: "Отключён",
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

const fmtValue = (v: unknown): string => {
  if (v === null || v === undefined) return "—"
  if (typeof v === "boolean") return v ? "да" : "нет"
  if (typeof v === "string") {
    if (v in STATUS_LABEL) return STATUS_LABEL[v as BillingStatus]
    if (ISO_DATE.test(v)) return formatShortDate(v)
    return v.length > 40 ? `«${v.slice(0, 40)}…»` : `«${v}»`
  }
  return String(v)
}

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {}

export type AuditLike = { action: string; metadata: unknown }

// The event's headline; console billing updates are named by their kind.
export const auditActionLabel = (e: AuditLike): string => {
  if (e.action === "workspace.billingUpdate") {
    const kind = asRecord(e.metadata).kind
    if (typeof kind === "string" && BILLING_KIND_LABEL[kind]) return BILLING_KIND_LABEL[kind]
  }
  return ACTION_LABEL[e.action] ?? e.action
}

const moduleSide = (v: unknown): string => {
  const s = asRecord(v)
  const mode = typeof s.mode === "string" ? (MODULE_MODE_LABEL[s.mode] ?? s.mode) : "?"
  const until = typeof s.compUntil === "string" ? ` до ${formatShortDate(s.compUntil)}` : ""
  const price = typeof s.customPrice === "number" ? ` (${s.customPrice} ₽/мес)` : ""
  return `${mode}${until}${price}`
}

// Renders the bits of metadata worth reading at a glance. The raw object is
// deliberately not dumped: it carries ids that mean nothing to a human.
export const describeAudit = (e: AuditLike): string | null => {
  const m = asRecord(e.metadata)
  if (e.action === "workspace.create") {
    const owner = typeof m.ownerEmail === "string" ? m.ownerEmail : null
    if (!owner) return null
    return m.ownerCreated === true
      ? `владельцу ${owner} (аккаунт создан)`
      : `владельцу ${owner}`
  }
  if (e.action === "workspace.transferOwner") {
    const to = typeof m.toOwnerEmail === "string" ? m.toOwnerEmail : null
    return to ? `новый владелец ${to}` : null
  }
  if (e.action === "workspace.update") {
    const parts = Object.entries(m).map(([k, v]) => {
      if (k === "isActive") return v === false ? "отключён" : "снова активен"
      if (k === "name") return `название → «${String(v)}»`
      if (k === "type") return `тип → ${String(v)}`
      if (k === "timezone") return `часовой пояс → ${String(v)}`
      return `${k} → ${String(v)}`
    })
    return parts.length ? parts.join(", ") : null
  }
  // Expire: { from: "TRIAL", to: "PAST_DUE" }.
  if (e.action === "workspace.billingExpire") {
    return `${fmtValue(m.from)} → ${fmtValue(m.to)}`
  }
  // Console update: { kind, days?, from: {changed fields}, to: {...} }.
  if (e.action === "workspace.billingUpdate") {
    const from = asRecord(m.from)
    const to = asRecord(m.to)
    const parts = Object.keys(to).map(
      (k) => `${BILLING_FIELD_LABEL[k] ?? k}: ${fmtValue(from[k])} → ${fmtValue(to[k])}`,
    )
    if (typeof m.days === "number") parts.unshift(`на ${m.days} дн.`)
    return parts.length ? parts.join(", ") : null
  }
  // { module, from: {mode, compUntil?, customPrice?}, to: {...} }.
  if (e.action === "workspace.moduleUpdate") {
    const name = typeof m.module === "string" ? (MODULE_LABEL[m.module] ?? m.module) : "?"
    return `«${name}»: ${moduleSide(m.from)} → ${moduleSide(m.to)}`
  }
  // { feature, from: boolean, to: boolean }.
  if (e.action === "workspace.forceFeature") {
    const label =
      APP_SECTIONS.find((s) => s.feature === m.feature)?.label ?? String(m.feature)
    return `«${label}»: ${m.from === true ? "вкл" : "выкл"} → ${m.to === true ? "вкл" : "выкл"}`
  }
  return null
}

export const fmtAuditWhen = (iso: string): string =>
  new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })

// Who did what to which club, from the console. Self-contained so the platform
// page needn't thread its state.
export function PlatformAuditFeed() {
  const [events, setEvents] = useState<PlatformAuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [curPage, setCurPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await fetchPlatformAudit({ curPage, perPage: PER_PAGE })
      setEvents(page.data)
      setTotal(page.total)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить журнал."))
    } finally {
      setLoading(false)
    }
  }, [curPage])

  useEffect(() => {
    void load()
  }, [load])

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Журнал платформы</h2>
        <p className="text-sm text-muted-foreground">
          Что делали в этой консоли: создание клубов, передача владельцам,
          тарифы, модули и разделы клубов. Действия внутри клуба — в журнале самого клуба.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : events.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Пока пусто — здесь появятся действия из этой консоли.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {events.map((e) => {
            const detail = describeAudit(e)
            return (
              <li key={e.id} className="flex flex-wrap gap-x-2 px-3 py-2 text-sm">
                <span className="font-medium">
                  {auditActionLabel(e)}
                </span>
                <span className="text-muted-foreground">
                  {e.workspaceName ?? "— клуб удалён —"}
                </span>
                {detail && (
                  <span className="text-muted-foreground">· {detail}</span>
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {e.actorLabel ?? "—"} · {fmtAuditWhen(e.createdAt)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={curPage <= 1}
            onClick={() => setCurPage((p) => Math.max(1, p - 1))}
          >
            Назад
          </Button>
          <span className="text-xs text-muted-foreground">
            {curPage} / {pageCount}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={curPage >= pageCount}
            onClick={() => setCurPage((p) => Math.min(pageCount, p + 1))}
          >
            Вперёд
          </Button>
        </div>
      )}
    </section>
  )
}
