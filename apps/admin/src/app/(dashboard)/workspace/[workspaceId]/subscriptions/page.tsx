"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  createPlan,
  deletePlan,
  listPlans,
  listRenewalCandidates,
  updatePlan,
  type Plan,
  type RenewalCandidate,
} from "../../../../../shared/api/subscriptions"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { inputCls } from "../../../../../shared/lib/input-class"

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [currency, setCurrency] = useState("RUB")
  const [durationDays, setDurationDays] = useState("30")
  const [classCount, setClassCount] = useState("")
  const [isFreeTrial, setIsFreeTrial] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const [plansRes, candidatesRes] = await Promise.all([
        listPlans({ workspaceId, includeInactive: true }),
        listRenewalCandidates({ workspaceId }),
      ])
      setPlans(plansRes.data)
      setCandidates(candidatesRes.data)
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

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId || !name.trim()) return
    setSaving(true)
    try {
      await createPlan({
        workspaceId,
        data: {
          name: name.trim(),
          price: Number(price) || 0,
          currency: currency.trim().toUpperCase(),
          durationDays: Number(durationDays) || 30,
          classCount: classCount.trim() ? Number(classCount) : null,
          isFreeTrial,
        },
      })
      setName("")
      setPrice("")
      setDurationDays("30")
      setClassCount("")
      setIsFreeTrial(false)
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось создать тариф"))
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
        onSubmit={onCreate}
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card/40 p-4 sm:grid-cols-5"
      >
        <input
          className={`${inputCls} sm:col-span-2`}
          placeholder="Название (напр. «Безлимит месяц»)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Цена"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Валюта"
          maxLength={3}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Дней доступа"
          inputMode="numeric"
          value={durationDays}
          onChange={(e) => setDurationDays(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Занятий (пусто = безлимит)"
          inputMode="numeric"
          value={classCount}
          onChange={(e) => setClassCount(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm sm:col-span-4">
          <input
            type="checkbox"
            checked={isFreeTrial}
            onChange={(e) => setIsFreeTrial(e.target.checked)}
          />
          Первое бесплатное занятие (один раз на ученика)
        </label>
        <div className="sm:col-span-5">
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? "Сохранение…" : "Добавить тариф"}
          </Button>
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
                  {!p.isActive && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      В архиве
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  {p.price} {p.currency} ·{" "}
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
