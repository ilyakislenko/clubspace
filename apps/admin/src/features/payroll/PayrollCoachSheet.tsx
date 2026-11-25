"use client"

import { ChevronDown, ChevronRight, X } from "lucide-react"
import { useEffect, useState } from "react"

import { agree, cap, countForm } from "@clubspace/ui-kit/brand"
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import {
  addPayrollAdjustment,
  deletePayrollAdjustment,
  listCoachRates,
  listPayrollClasses,
  type CoachRateHistory,
  type PayrollAdjustment,
  type PayrollClass,
  type PayrollClasses,
  type PayrollLine,
  type PayrollMonth,
} from "../../shared/api/payroll"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls, inputClsFull } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { pluralRu } from "../../shared/lib/plural-ru"
import { confirmLeave, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { currencySymbol, formatAmount } from "../subscriptions/subscription-display"
import { CoachRateForm } from "./CoachRateForm"
import {
  adjustmentText,
  lineFacts,
  missingRateText,
  monthFrom,
  monthName,
  monthTitle,
  rateText,
  signedMoney,
} from "./payroll-view"

const L = FORM_LIMITS.payrollAdjustment

const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" })

/**
 * One coach's month in a side panel: what the rate gave and why, the bonuses
 * and deductions, the classes behind the numbers and the rate itself. An open
 * month edits the adjustments and the rate here; a closed one is read-only
 * (the snapshot's rate, no forms).
 */
export function PayrollCoachSheet({
  workspaceId,
  month,
  line,
  currentMonth,
  timezone,
  coachPayVisible,
  startWithRate,
  onClose,
  onChanged,
}: {
  workspaceId: string
  month: PayrollMonth
  // null = the panel is closed.
  line: PayrollLine | null
  // The club's current month: the rate form offers months up to two ahead.
  currentMonth: string
  timezone: string
  coachPayVisible: boolean
  // A staff row without anything this month: the panel opens on the rate form.
  startWithRate: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const vocabulary = useVocabulary()
  const open = line !== null
  const coachId = line?.coachId ?? null
  const editable = month.status === "open"
  const currency = month.currency
  // The form swapped in, at most one at a time.
  const [form, setForm] = useState<"adjustment" | "rate" | null>(null)
  const [formDirty, setFormDirty] = useState(false)
  // undefined = loading; null = not a rate-holding staff member (removed).
  const [history, setHistory] = useState<CoachRateHistory | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadHistory = async (id: string): Promise<CoachRateHistory | null> => {
    const r = await listCoachRates({ workspaceId })
    return r.coaches.find((c) => c.coachId === id) ?? null
  }

  useEffect(() => {
    setForm(startWithRate && editable ? "rate" : null)
    setFormDirty(false)
    setError(null)
    setHistory(undefined)
    if (!coachId || !editable) return
    let live = true
    loadHistory(coachId)
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistory(null))
    return () => {
      live = false
    }
    // `loadHistory` closes over workspaceId only; `startWithRate` is read when
    // the panel opens for a coach, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, coachId, editable, month.month])

  useDirtyGuard(open && formDirty)

  const requestClose = async () => {
    if (await confirmLeave()) onClose()
  }

  const leaveForm = async () => {
    if (formDirty && !(await confirmLeave())) return
    setForm(null)
    setFormDirty(false)
  }

  const formSaved = () => {
    setForm(null)
    setFormDirty(false)
    onChanged()
  }

  const removeAdjustment = async (adj: PayrollAdjustment) => {
    const ok = await confirmDialog({
      title: "Удалить корректировку?",
      description: `${signedMoney(adj.amount, adj.currency)} · ${adj.comment}. Итог за ${monthName(month.month)} пересчитается.`,
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await deletePayrollAdjustment({ workspaceId, adjustmentId: adj.id })
      onChanged()
    } catch (e) {
      setError(errorMessage(e, "Не удалось удалить корректировку"))
    } finally {
      setBusy(false)
    }
  }

  const facts = line ? lineFacts(line, vocabulary, currency) : []
  const thisYear = Number(currentMonth.slice(0, 4))
  // Rates already saved for later months (newest first in the list).
  const later = (history?.rates ?? []).filter((r) => r.effectiveFrom > month.month).reverse()

  return (
    <Sheet open={open} onOpenChange={(next) => !next && void requestClose()}>
      <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-lg">
        {line && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">{line.name}</SheetTitle>
              <SheetDescription>
                {monthTitle(month.month)} · итого {formatAmount(line.total, currency)}
              </SheetDescription>
            </SheetHeader>

            <section className="space-y-1 text-sm" aria-label="Начислено">
              {!line.rate ? (
                <p className="text-muted-foreground">
                  {missingRateText(line, currency)} · {line.classes}{" "}
                  {countForm(line.classes, vocabulary.session, pluralRu)},{" "}
                  {line.marks} {pluralRu(line.marks, "отметка", "отметки", "отметок")}
                </p>
              ) : facts.length === 0 ? (
                <p className="text-muted-foreground">Начислений по ставке нет</p>
              ) : (
                <ul className="space-y-1">
                  {facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </section>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <section className="space-y-2 text-sm" aria-label="Корректировки">
              <h3 className="font-medium">Корректировки</h3>
              {line.adjustments.length > 0 && (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {line.adjustments.map((adj) => (
                    <li
                      key={adj.id}
                      className={cn("flex items-center gap-2 px-3 py-2", adj.ignored && "text-muted-foreground")}
                    >
                      <span className="flex-1">{adjustmentText(adj, timezone)}</span>
                      {editable && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          disabled={busy}
                          aria-label={`Удалить корректировку «${adj.comment}»`}
                          onClick={() => void removeAdjustment(adj)}
                        >
                          <X className="size-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {line.adjustments.length === 0 && !editable && <p className="text-muted-foreground">Нет</p>}
              {editable &&
                (form === "adjustment" ? (
                  <AdjustmentForm
                    workspaceId={workspaceId}
                    month={month.month}
                    coachId={line.coachId}
                    currency={currency}
                    coachPayVisible={coachPayVisible}
                    onDirty={setFormDirty}
                    onCancel={() => void leaveForm()}
                    onSaved={formSaved}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={form !== null}
                    onClick={() => setForm("adjustment")}
                  >
                    Добавить корректировку
                  </Button>
                ))}
            </section>

            <ClassesSection workspaceId={workspaceId} month={month.month} coachId={line.coachId} />

            <section className="space-y-2 text-sm" aria-label="Ставка">
              <h3 className="font-medium">Ставка</h3>
              {editable && form === "rate" && history !== undefined ? (
                <CoachRateForm
                  workspaceId={workspaceId}
                  coachId={line.coachId}
                  viewedMonth={month.month}
                  currentMonth={currentMonth}
                  rate={line.rate}
                  currency={currency}
                  version={history?.updatedAt ?? null}
                  onDirty={setFormDirty}
                  onCancel={() => void leaveForm()}
                  onReload={async () => {
                    const next = await loadHistory(line.coachId)
                    setHistory(next)
                    return next?.updatedAt ?? null
                  }}
                  onSaved={() => {
                    formSaved()
                    void loadHistory(line.coachId)
                      .then(setHistory)
                      .catch(() => undefined)
                  }}
                />
              ) : (
                <>
                  {line.rate ? (
                    <p>
                      {rateText(line.rate, vocabulary, currency)}
                      <span className="text-muted-foreground">
                        {" "}
                        · с {monthFrom(line.rate.effectiveFrom, thisYear)}
                      </span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground">{missingRateText(line, currency)}</p>
                  )}
                  {later.map((r) => (
                    <p key={r.id} className="text-muted-foreground">
                      С {monthFrom(r.effectiveFrom, thisYear)}: {rateText(r, vocabulary, currency)}
                    </p>
                  ))}
                  {/* Only staff can hold a rate: a removed coach's row keeps its numbers. */}
                  {editable && history !== null && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={history === undefined || form !== null}
                      onClick={() => setForm("rate")}
                    >
                      {line.rate ? "Изменить ставку" : "Задать ставку"}
                    </Button>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

// «Премия / Удержание», the amount and a comment the coach may see.
function AdjustmentForm({
  workspaceId,
  month,
  coachId,
  currency,
  coachPayVisible,
  onDirty,
  onCancel,
  onSaved,
}: {
  workspaceId: string
  month: string
  coachId: string
  currency: string
  coachPayVisible: boolean
  onDirty: (dirty: boolean) => void
  onCancel: () => void
  onSaved: () => void
}) {
  const vocabulary = useVocabulary()
  const [sign, setSign] = useState<1 | -1>(1)
  const [amount, setAmount] = useState("")
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // The contract bounds |amount|; zero is a refine it can't carry.
  const range = { min: 1, max: L.amount.max }

  useEffect(() => {
    onDirty(amount.trim() !== "" || comment.trim() !== "")
  }, [amount, comment, onDirty])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = parseIntInput(amount, range)
    const text = comment.trim()
    if (value === null) {
      setError(`Сумма — от ${range.min} до ${range.max.toLocaleString("ru-RU")}`)
      return
    }
    if (text.length < Math.max(1, L.comment.min)) {
      setError("Напишите комментарий")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await addPayrollAdjustment({
        workspaceId,
        data: { month, coachId, amount: sign * value, comment: text },
      })
      onSaved()
    } catch (err) {
      setError(errorMessage(err, "Не удалось добавить корректировку"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-3" aria-label="Новая корректировка">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Премия или удержание">
          {([1, -1] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sign === s}
              className={cn("rounded px-3 py-1 text-sm", sign === s ? "bg-muted font-medium" : "text-muted-foreground")}
              onClick={() => setSign(s)}
            >
              {s === 1 ? "Премия" : "Удержание"}
            </button>
          ))}
        </div>
        <input
          className={`${inputCls} w-32`}
          inputMode="numeric"
          aria-label="Сумма"
          placeholder="Сумма"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span className="text-muted-foreground">{currencySymbol(currency)}</span>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Комментарий</span>
        <input
          className={inputClsFull}
          maxLength={L.comment.max}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <span className="block text-xs text-muted-foreground">
          {coachPayVisible
            ? `Увидит ${vocabulary.coach.nom} в приложении`
            : `Увидит ${vocabulary.coach.nom}, если клуб показывает выплаты`}
        </span>
      </label>
      {error && <p className="text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Добавляем…" : "Добавить"}
        </Button>
      </div>
    </form>
  )
}

// «замена» / «не оплачено» / «отменено» / «замена: Иванов» in the club's words.
const classNote = (c: PayrollClass, session: Parameters<typeof agree>[0]): string | null => {
  switch (c.status) {
    case "cancelled":
      return agree(session, "отменена", "отменено")
    case "other_coach":
      return c.ranBy ? `замена: ${c.ranBy.name}` : "замена"
    case "unpaid":
      return [c.substitute ? "замена" : null, agree(session, "не оплачена", "не оплачено")]
        .filter(Boolean)
        .join(" · ")
    case "paid":
      return c.substitute ? "замена" : null
  }
}

// The month's classes, read on the first expand.
function ClassesSection({
  workspaceId,
  month,
  coachId,
}: {
  workspaceId: string
  month: string
  coachId: string
}) {
  const vocabulary = useVocabulary()
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState<PayrollClasses | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setExpanded(false)
    setData(null)
    setError(null)
  }, [coachId, month])

  const toggle = async () => {
    const next = !expanded
    setExpanded(next)
    if (!next || data) return
    try {
      setData(await listPayrollClasses({ workspaceId, coachId, month }))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, `Не удалось загрузить ${vocabulary.session.nomPl}`))
    }
  }

  return (
    <section className="space-y-2 text-sm" aria-label={cap(vocabulary.session.nomPl)}>
      <button
        type="button"
        className="flex items-center gap-1 font-medium"
        aria-expanded={expanded}
        onClick={() => void toggle()}
      >
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {cap(vocabulary.session.nomPl)}
      </button>
      {expanded &&
        (error ? (
          <p className="text-destructive">{error}</p>
        ) : !data ? (
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
        ) : data.items.length === 0 ? (
          <p className="text-muted-foreground">
            {cap(vocabulary.session.genPl)} с открытым журналом в этом месяце нет
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.items.map((c) => {
              const note = classNote(c, vocabulary.session)
              const muted = c.status === "cancelled" || c.status === "other_coach"
              return (
                <li key={c.sessionId} className={cn("flex items-baseline gap-3 px-3 py-2", muted && "text-muted-foreground")}>
                  <span className="w-16 shrink-0 tabular-nums">{dayFmt.format(new Date(`${c.date}T00:00:00Z`))}</span>
                  <span className="flex-1">
                    {c.groupName}
                    {note && <span className="text-xs text-muted-foreground"> · {note}</span>}
                  </span>
                  <span className="tabular-nums" title="Отметок">
                    {c.marks}
                  </span>
                </li>
              )
            })}
          </ul>
        ))}
    </section>
  )
}
