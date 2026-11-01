"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  fetchPlatformAudit,
  type PlatformAuditEvent,
} from "../../shared/api/platform"
import { errorMessage } from "../../shared/lib/error-message"
import {
  declineReasonRu,
  formatShortDate,
  LEGAL_SOURCE_LABEL,
  legalEditionsLabel,
  MODULE_NAME,
  STATUS_LABEL,
  type BillingStatus,
} from "../billing/billing-view"
import { formatAmount } from "../subscriptions/subscription-display"
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
  "workspace.featureLock": "Раздел закреплён платформой",
  "workspace.featureUnlock": "Раздел снова у клуба",
  "workspace.promoApply": "Промо",
  "workspace.billingPayment": "Оплата картой",
  "workspace.billingChargeFailed": "Автосписание не прошло",
  "workspace.billingRefund": "Возврат платежа",
  "workspace.billingAutopay": "Автосписание",
  "workspace.billingCardRemoved": "Клуб удалил карту",
  "workspace.billingPeriod": "Период оплаты",
  "workspace.moduleSelfServe": "Модуль (сам клуб)",
  "workspace.billingCardCheck": "Клуб привязывает карту (проверочное списание)",
  "workspace.billingArchive": "Клуб перенесён в архив",
  "workspace.onboardingHelpRequest": "Заявка на помощь с подключением",
  "workspace.onboardingHelpUpdate": "Заявка на помощь с подключением обработана",
  "workspace.legalAccept": "Принята оферта",
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
  setCardTrial: "Тариф: пробный период с картой",
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
  discountUntil: "скидка до",
  freeUntil: "бесплатно до",
  setupFeeWaived: "без платы за подключение",
  billingPeriodMonths: "период, мес",
  cardTrial: "пробный с картой (— = по умолчанию)",
}

// What a club's own module change ended with.
const MODULE_OUTCOME_LABEL: Record<string, string> = {
  CONNECTED: "подключён",
  PAYMENT_REQUIRED: "переход к оплате",
  PAYMENT_PENDING: "списание с карты",
  RESTORED: "отключение отменено",
  DISCONNECTED: "отключён",
  DISCONNECT_SCHEDULED: "отключится в конце периода",
}

// A «помощь с подключением» request's status.
export const ONBOARDING_STATUS_LABEL: Record<string, string> = {
  OPEN: "открыта",
  DONE: "выполнена",
  CANCELED: "отменена",
}

const periodLabel = (months: unknown): string =>
  months === 12 ? "за год" : months === 1 ? "помесячно" : `${String(months)} мес.`

const moduleName = (code: unknown): string =>
  typeof code === "string" ? (MODULE_NAME[code] ?? code) : "?"

// Rubles with the event's currency (RUB when the metadata has none).
const money = (amount: unknown, currency: unknown): string =>
  typeof amount === "number"
    ? formatAmount(amount, typeof currency === "string" ? currency : "RUB")
    : "?"

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

// The event's headline; console billing updates are named by their kind, card
// payments by what they paid for.
export const auditActionLabel = (e: AuditLike): string => {
  if (e.action === "workspace.billingUpdate") {
    const kind = asRecord(e.metadata).kind
    if (typeof kind === "string" && BILLING_KIND_LABEL[kind]) return BILLING_KIND_LABEL[kind]
  }
  if (e.action === "workspace.billingPayment") {
    const m = asRecord(e.metadata)
    if (m.free === true) return "Продление без оплаты (0 ₽)"
    if (m.kind === "MODULE") return "Оплата модуля"
    if (m.initiator === "AUTOPAY") return "Автосписание прошло"
    if (m.initiator === "PLATFORM") return "Списание командой ClubSpace"
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
    return `«${moduleName(m.module)}»: ${moduleSide(m.from)} → ${moduleSide(m.to)}`
  }
  // { feature, from: boolean, to: boolean }.
  if (e.action === "workspace.forceFeature") {
    const label =
      APP_SECTIONS.find((s) => s.feature === m.feature)?.label ?? String(m.feature)
    return `«${label}»: ${m.from === true ? "вкл" : "выкл"} → ${m.to === true ? "вкл" : "выкл"}`
  }
  // { feature, from, to, until (YYYY-MM-DD | null), previousLock }.
  if (e.action === "workspace.featureLock") {
    const label =
      APP_SECTIONS.find((s) => s.feature === m.feature)?.label ?? String(m.feature)
    const until = typeof m.until === "string" ? ` до ${formatShortDate(m.until)}` : ""
    return `«${label}»: ${m.to === true ? "вкл" : "выкл"}${until}`
  }
  // { feature, lock: { enabled, until } }.
  if (e.action === "workspace.featureUnlock") {
    return `«${APP_SECTIONS.find((s) => s.feature === m.feature)?.label ?? String(m.feature)}»`
  }
  // { preset, months?, discountPercent?, summary, from, to, module? }.
  if (e.action === "workspace.promoApply") {
    return typeof m.summary === "string" ? m.summary : null
  }
  // { paymentId, kind, initiator, module, amount, currency, periodMonths,
  //   from, to (billing status), currentPeriodEnd, cardSaved, free? }.
  if (e.action === "workspace.billingPayment") {
    const parts = [money(m.amount, m.currency)]
    if (m.kind === "MODULE") parts.push(`модуль «${moduleName(m.module)}»`)
    else if (typeof m.periodMonths === "number") parts.push(periodLabel(m.periodMonths))
    if (m.from !== m.to) parts.push(`${fmtValue(m.from)} → ${fmtValue(m.to)}`)
    if (typeof m.currentPeriodEnd === "string") {
      parts.push(`оплачено до ${formatShortDate(m.currentPeriodEnd)}`)
    }
    if (m.cardSaved === true) parts.push("карта сохранена")
    return parts.join(", ")
  }
  // { paymentId, amount, currency, reason, attempt, nextAttemptAt }.
  if (e.action === "workspace.billingChargeFailed") {
    const reason = typeof m.reason === "string" ? m.reason : null
    const parts = [`${money(m.amount, m.currency)}: ${declineReasonRu(reason)}`]
    if (typeof m.attempt === "number") parts.push(`попытка ${m.attempt}`)
    if (typeof m.nextAttemptAt === "string") {
      parts.push(`следующая ${formatShortDate(m.nextAttemptAt)}`)
    }
    return parts.join(", ")
  }
  // { paymentId, amount, refundedTotal, paymentAmount, currency, reason }.
  if (e.action === "workspace.billingRefund") {
    let text = `${money(m.amount, m.currency)} из ${money(m.paymentAmount, m.currency)}`
    if (typeof m.refundedTotal === "number" && m.refundedTotal !== m.amount) {
      text += `, всего возвращено ${money(m.refundedTotal, m.currency)}`
    }
    if (typeof m.reason === "string" && m.reason) text += ` · ${fmtValue(m.reason)}`
    return text
  }
  // { from: boolean, to: boolean }.
  if (e.action === "workspace.billingAutopay") {
    return `${m.from === true ? "вкл" : "выкл"} → ${m.to === true ? "вкл" : "выкл"}`
  }
  // { cardLast4 }.
  if (e.action === "workspace.billingCardRemoved") {
    return typeof m.cardLast4 === "string" ? `карта •••• ${m.cardLast4}` : null
  }
  // { from: months, to: months }.
  if (e.action === "workspace.billingPeriod") {
    return `${periodLabel(m.from)} → ${periodLabel(m.to)}`
  }
  // { module, outcome }.
  if (e.action === "workspace.moduleSelfServe") {
    const outcome =
      typeof m.outcome === "string" ? (MODULE_OUTCOME_LABEL[m.outcome] ?? m.outcome) : "?"
    return `«${moduleName(m.module)}»: ${outcome}`
  }
  // { paymentId, amount }.
  if (e.action === "workspace.billingCardCheck") {
    return `проверка ${money(m.amount, "RUB")}, сразу возвращается`
  }
  // { archiveAfterDays }.
  if (e.action === "workspace.billingArchive") {
    return typeof m.archiveAfterDays === "number"
      ? `через ${m.archiveAfterDays} дн. паузы: участники клуб не видят, данные сохранены`
      : "участники клуб не видят, данные сохранены"
  }
  // { requestId, updated }.
  if (e.action === "workspace.onboardingHelpRequest") {
    return m.updated === true ? "заявка дополнена" : "новая заявка"
  }
  // { requestId, from, to }.
  if (e.action === "workspace.onboardingHelpUpdate") {
    const status = (v: unknown): string =>
      typeof v === "string" ? (ONBOARDING_STATUS_LABEL[v] ?? v) : "?"
    return `${status(m.from)} → ${status(m.to)}`
  }
  // { source, offerVersion, dpaVersion, paymentId?, ownerEmail? }.
  if (e.action === "workspace.legalAccept") {
    const parts = [
      Object.entries(LEGAL_SOURCE_LABEL).find(([k]) => k === m.source)?.[1] ??
        fmtValue(m.source),
    ]
    if (typeof m.offerVersion === "string" && typeof m.dpaVersion === "string") {
      parts.push(legalEditionsLabel({ offerVersion: m.offerVersion, dpaVersion: m.dpaVersion }))
    }
    if (typeof m.ownerEmail === "string") parts.push(`владелец ${m.ownerEmail}`)
    return parts.join(", ")
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
          тарифы, модули и разделы клубов, — а также оплата клубов картой:
          платежи, автосписания, возвраты, карта и модули, подключённые самим
          клубом, архивация неоплаченных клубов и заявки на помощь с
          подключением. Остальные действия внутри клуба — в журнале самого клуба.
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
