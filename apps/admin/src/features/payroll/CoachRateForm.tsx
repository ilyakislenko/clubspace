"use client"

import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { setCoachRate, type PayrollRate } from "../../shared/api/payroll"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { sameData } from "../../shared/lib/use-dirty-guard"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { isStaleUpdate, StaleUpdateNotice } from "../../shared/ui/stale-update-notice"
import { currencySymbol } from "../subscriptions/subscription-display"
import { monthTitle, parsePercentBp, rateFormOf, rateMonthOptions, type RateForm } from "./payroll-view"

const L = FORM_LIMITS.coachRate

// The rate from a month on: the four amounts and the per-class threshold. It
// sends the coach's rate version read when the panel opened (`updatedAt` of
// listCoachRates, the newest change of any of the coach's rates) as
// `expectedUpdatedAt`, so a colleague's save in between answers 409.
export function CoachRateForm({
  workspaceId,
  coachId,
  viewedMonth,
  currentMonth,
  currency,
  rate,
  version,
  onDirty,
  onCancel,
  onSaved,
  onReload,
}: {
  workspaceId: string
  coachId: string
  viewedMonth: string
  currentMonth: string
  // The club's payroll currency (the amounts' unit).
  currency: string
  // The rate in force in the viewed month (prefills the form).
  rate: PayrollRate | null
  // null = the coach has no rate yet.
  version: string | null
  onDirty: (dirty: boolean) => void
  onCancel: () => void
  onSaved: () => void
  // «Обновить» after a 409: the coach's version read again.
  onReload: () => Promise<string | null>
}) {
  const vocabulary = useVocabulary()
  // From the club's current month by default: a past (still open) month stays
  // selectable, but a save never rewrites it unless picked.
  const [opened] = useState(() =>
    rateFormOf(rate, viewedMonth > currentMonth ? viewedMonth : currentMonth),
  )
  const [form, setForm] = useState<RateForm>(opened)
  const [expected, setExpected] = useState(version)
  const [errors, setErrors] = useState<Partial<Record<keyof RateForm, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)

  const dirty = !sameData(form, opened)
  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])

  const set = <K extends keyof RateForm>(key: K, value: RateForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const amountOrZero = (raw: string, range: { min: number; max: number }): number | null =>
    raw.trim() === "" ? 0 : parseIntInput(raw, range)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    const amountError = `От ${L.fixedMonthly.min} до ${L.fixedMonthly.max.toLocaleString("ru-RU")} или пусто`
    const fixedMonthly = amountOrZero(form.fixedMonthly, L.fixedMonthly)
    if (fixedMonthly === null) errs.fixedMonthly = amountError
    const perClass = amountOrZero(form.perClass, L.perClass)
    if (perClass === null) errs.perClass = amountError
    const perStudent = amountOrZero(form.perStudent, L.perStudent)
    if (perStudent === null) errs.perStudent = amountError
    const perClassMinStudents = parseIntInput(form.perClassMinStudents, L.perClassMinStudents)
    if (perClassMinStudents === null)
      errs.perClassMinStudents = `От ${L.perClassMinStudents.min} до ${L.perClassMinStudents.max}`
    const revenueBp = parsePercentBp(form.percent, L.revenueBp)
    if (revenueBp === null)
      errs.percent = `От ${L.revenueBp.min / 100} до ${L.revenueBp.max / 100} %, до двух знаков после запятой`
    setErrors(errs)
    if (
      fixedMonthly === null ||
      perClass === null ||
      perStudent === null ||
      perClassMinStudents === null ||
      revenueBp === null
    )
      return
    setSaving(true)
    setError(null)
    setStale(null)
    try {
      await setCoachRate({
        workspaceId,
        coachId,
        data: {
          effectiveFrom: form.effectiveFrom,
          fixedMonthly,
          perClass,
          perClassMinStudents,
          perStudent,
          revenueBp,
          ...(expected ? { expectedUpdatedAt: expected } : {}),
        },
      })
      onSaved()
    } catch (err) {
      if (isStaleUpdate(err)) setStale(err)
      else setError(errorMessage(err, "Не удалось сохранить ставку"))
    } finally {
      setSaving(false)
    }
  }

  const reload = async () => {
    try {
      setExpected(await onReload())
      setStale(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить ставку"))
    }
  }

  const field = (key: keyof RateForm, label: string, suffix?: string) => (
    <label className="space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <input
          className={`${inputCls} w-32`}
          inputMode={key === "percent" ? "decimal" : "numeric"}
          value={form[key]}
          onChange={(e) => set(key, e.target.value)}
        />
        {suffix && <span className="text-muted-foreground">{suffix}</span>}
      </span>
      {errors[key] && <span className="block text-xs text-destructive">{errors[key]}</span>}
    </label>
  )

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border p-3" aria-label="Ставка">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Действует с</span>
        <select
          className={`${inputCls} block`}
          value={form.effectiveFrom}
          onChange={(e) => set("effectiveFrom", e.target.value)}
        >
          {rateMonthOptions(viewedMonth, currentMonth).map((m) => (
            <option key={m} value={m}>
              {monthTitle(m)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        {field("fixedMonthly", "Оклад в месяц", currencySymbol(currency))}
        {field("perClass", `За ${vocabulary.session.acc}`, currencySymbol(currency))}
        {field("perStudent", "За отметку ученика", currencySymbol(currency))}
        {field("percent", "Процент от оплат учеников", "%")}
      </div>
      <label className="flex flex-wrap items-center gap-2">
        Платить за {vocabulary.session.acc}, если пришло не меньше
        <input
          className={`${inputCls} w-16`}
          inputMode="numeric"
          aria-label="Не меньше учеников"
          value={form.perClassMinStudents}
          onChange={(e) => set("perClassMinStudents", e.target.value)}
        />
      </label>
      {errors.perClassMinStudents && (
        <span className="block text-xs text-destructive">{errors.perClassMinStudents}</span>
      )}
      {error && <p className="text-destructive">{error}</p>}
      {stale !== null && <StaleUpdateNotice error={stale} onReload={reload} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить ставку"}
        </Button>
      </div>
    </form>
  )
}
