"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  createPlan,
  deletePlan,
  listAwaitingPayment,
  listPlans,
  listRenewalCandidates,
  updatePlan,
  type AwaitingPayment,
  type Plan,
  type RenewalCandidate,
} from "../../../../../shared/api/subscriptions"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { inputCls } from "../../../../../shared/lib/input-class"
import { parseIntInput } from "../../../../../shared/lib/parse-int-input"
import { formatAmount } from "../../../../../features/subscriptions/subscription-display"

const REASON_LABEL: Record<RenewalCandidate["reason"], string> = {
  out_of_classes: "Занятия закончились",
  low_classes: "Осталось 1 занятие",
  access_expiring: "Доступ заканчивается",
}

const REASON_CLASS: Record<RenewalCandidate["reason"], string> = {
  out_of_classes: "bg-red-50 text-red-700 ring-red-600/20",
  low_classes: "bg-amber-50 text-amber-700 ring-amber-600/20",
  access_expiring: "bg-amber-50 text-amber-700 ring-amber-600/20",
}

const candidateName = (c: RenewalCandidate): string => {
  const full = [c.firstname, c.lastname].filter(Boolean).join(" ").trim()
  return full || c.email
}

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  })

export default function WorkspaceSubscriptionsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [plans, setPlans] = useState<Plan[]>([])
  const [candidates, setCandidates] = useState<RenewalCandidate[]>([])
  const [awaiting, setAwaiting] = useState<AwaitingPayment[]>([])
  const [awaitingTotal, setAwaitingTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [currency, setCurrency] = useState("RUB")
  const [durationDays, setDurationDays] = useState("30")
  const [classCount, setClassCount] = useState("")
  const [isFreeTrial, setIsFreeTrial] = useState(false)
  const [startsOnFirstVisit, setStartsOnFirstVisit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const [plansRes, candidatesRes, awaitingRes] = await Promise.all([
        listPlans({ workspaceId, includeInactive: true }),
        listRenewalCandidates({ workspaceId }),
        listAwaitingPayment({ workspaceId }),
      ])
      setPlans(plansRes.data)
      setCandidates(candidatesRes.data)
      setAwaiting(awaitingRes.data)
      setAwaitingTotal(awaitingRes.total)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить тарифы"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const resetForm = () => {
    setEditingId(null)
    setName("")
    setPrice("")
    setCurrency("RUB")
    setDurationDays("30")
    setClassCount("")
    setIsFreeTrial(false)
    setStartsOnFirstVisit(false)
    setFieldErrors({})
  }

  const startEdit = (p: Plan) => {
    setEditingId(p.id)
    setName(p.name)
    setPrice(String(p.price))
    setCurrency(p.currency)
    setDurationDays(String(p.durationDays))
    setClassCount(p.classCount != null ? String(p.classCount) : "")
    setIsFreeTrial(p.isFreeTrial)
    setStartsOnFirstVisit(p.startsOnFirstVisit)
    setFieldErrors({})
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId) return
    const errs: Record<string, string> = {}
    const parsedPrice = parseIntInput(price, { min: 0, max: 100_000_000 })
    if (parsedPrice === null)
      errs.price = "Введите цену целым числом (0 — бесплатно)"
    const parsedDays = parseIntInput(durationDays, { min: 1, max: 3650 })
    if (parsedDays === null)
      errs.durationDays = "Введите число дней от 1 до 3650"
    const parsedClasses = classCount.trim()
      ? parseIntInput(classCount, { min: 1, max: 1000 })
      : null
    if (classCount.trim() && parsedClasses === null)
      errs.classCount = "Введите число занятий от 1 до 1000 или оставьте пустым"
    const cur = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(cur)) errs.currency = "Код из 3 букв, например RUB"
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0 || parsedPrice === null || parsedDays === null)
      return
    const data = {
      name: name.trim(),
      price: parsedPrice,
      currency: cur,
      durationDays: parsedDays,
      classCount: parsedClasses,
      isFreeTrial,
      startsOnFirstVisit,
    }
    setSaving(true)
    try {
      if (editingId) {
        await updatePlan({ workspaceId, planId: editingId, data })
      } else {
        await createPlan({ workspaceId, data })
      }
      resetForm()
      await load()
      setError(null)
    } catch (e) {
      setError(
        errorMessage(
          e,
          editingId ? "Не удалось сохранить тариф" : "Не удалось создать тариф",
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (p: Plan) => {
    if (!workspaceId) return
    try {
      await updatePlan({
        workspaceId,
        planId: p.id,
        data: { isActive: !p.isActive },
      })
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось изменить тариф"))
    }
  }

  const remove = async (p: Plan) => {
    if (!workspaceId) return
    if (!window.confirm(`Удалить тариф «${p.name}»?`)) return
    try {
      await deletePlan({ workspaceId, planId: p.id })
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось удалить тариф"))
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Тарифы и абонементы</h1>
        <p className="text-sm text-muted-foreground">
          Задайте тарифы клуба. Абонемент участнику назначается на его странице
          в разделе «Участники» — при назначении автоматически выставляется
          «Доступ до».
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-1 font-medium">Ожидают оплаты</div>
          {awaiting.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Все абонементы оплачены
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                Абонементы оформлены, но оплата не отмечена. Отметьте её на
                странице участника.
              </p>
              {awaitingTotal > awaiting.length && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Показаны первые {awaiting.length} из {awaitingTotal}
                </p>
              )}
              <ul className="divide-y divide-border">
                {awaiting.map((a) => (
                  <li key={a.subscriptionId}>
                    <Link
                      href={`/workspace/${workspaceId}/users/${a.userId}`}
                      className="-mx-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-2 transition hover:bg-muted"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {a.memberName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {a.planName} ·{" "}
                          {a.startDate
                            ? `с ${fmtDate(a.startDate)}`
                            : "начнётся с первой тренировки"}
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {formatAmount(a.amount, a.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {!loading && candidates.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-1 font-medium">Кому продать абонемент</div>
          <p className="mb-3 text-xs text-muted-foreground">
            У этих участников заканчиваются занятия или доступ. Назначьте новый
            абонемент на странице участника в разделе «Участники».
          </p>
          <ul className="divide-y divide-border">
            {candidates.map((c) => (
              <li key={c.userId}>
                <Link
                  href={`/workspace/${workspaceId}/users/${c.userId}`}
                  className="-mx-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-2 transition hover:bg-muted"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {candidateName(c)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.classesTotal != null
                        ? `Занятий: ${c.classesRemaining ?? 0} из ${c.classesTotal}`
                        : c.accessUntil
                          ? `Доступ до ${fmtDate(c.accessUntil)}`
                          : c.email}
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${REASON_CLASS[c.reason]}`}
                  >
                    {REASON_LABEL[c.reason]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card/40 p-4 sm:grid-cols-5"
      >
        {editingId && (
          <div className="text-sm font-medium sm:col-span-5">
            Редактирование тарифа
          </div>
        )}
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs text-muted-foreground">Название</span>
          <input
            className={`${inputCls} w-full`}
            placeholder="Например, «Безлимит месяц»"
            maxLength={255}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Цена</span>
          <input
            className={`${inputCls} w-full`}
            placeholder="0"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          {fieldErrors.price && (
            <span className="block text-xs text-destructive">
              {fieldErrors.price}
            </span>
          )}
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Валюта</span>
          <input
            className={`${inputCls} w-full`}
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
          {fieldErrors.currency && (
            <span className="block text-xs text-destructive">
              {fieldErrors.currency}
            </span>
          )}
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Дней доступа</span>
          <input
            className={`${inputCls} w-full`}
            inputMode="numeric"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
          />
          {fieldErrors.durationDays && (
            <span className="block text-xs text-destructive">
              {fieldErrors.durationDays}
            </span>
          )}
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">
            Занятий (пусто — безлимит)
          </span>
          <input
            className={`${inputCls} w-full`}
            inputMode="numeric"
            value={classCount}
            onChange={(e) => setClassCount(e.target.value)}
          />
          {fieldErrors.classCount && (
            <span className="block text-xs text-destructive">
              {fieldErrors.classCount}
            </span>
          )}
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-4">
          <input
            type="checkbox"
            checked={isFreeTrial}
            onChange={(e) => setIsFreeTrial(e.target.checked)}
          />
          Первое бесплатное занятие (один раз на ученика)
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-5">
          <input
            type="checkbox"
            checked={startsOnFirstVisit}
            onChange={(e) => setStartsOnFirstVisit(e.target.checked)}
          />
          Срок считается с первой тренировки
        </label>
        <p className="-mt-2 text-xs text-muted-foreground sm:col-span-5">
          Абонемент начнётся в день первой отметки, но не позже чем через 14
          дней после покупки
        </p>
        <div className="flex gap-2 sm:col-span-5">
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving
              ? "Сохранение…"
              : editingId
                ? "Сохранить"
                : "Добавить тариф"}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={resetForm}>
              Отмена
            </Button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">Тарифов пока нет.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {plans.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.isFreeTrial && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                      Пробное
                    </span>
                  )}
                  {p.startsOnFirstVisit && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                      с 1-й тренировки
                    </span>
                  )}
                  {!p.isActive && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      В архиве
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatAmount(p.price, p.currency)} ·{" "}
                  {p.classCount != null
                    ? `${p.classCount} занятий`
                    : "безлимит"}{" "}
                  · {p.durationDays} дн. доступа
                  {p.description ? ` · ${p.description}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startEdit(p)}
                >
                  Изменить
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void toggleActive(p)}
                >
                  {p.isActive ? "В архив" : "Вернуть"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void remove(p)}
                >
                  Удалить
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
