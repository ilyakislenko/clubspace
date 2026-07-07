"use client"

import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"

import {
  createPlan,
  deletePlan,
  listPlans,
  updatePlan,
  type Plan,
} from "../../../../../shared/api/subscriptions"
import { errorMessage } from "../../../../../shared/lib/error-message"

const inputCls =
  "rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"

export default function WorkspaceSubscriptionsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [plans, setPlans] = useState<Plan[]>([])
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
      const res = await listPlans({ workspaceId, includeInactive: true })
      setPlans(res.data)
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
