"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  createPlan,
  deletePlan,
  listPlans,
  updatePlan,
  type Plan,
} from "../../../../../shared/api/subscriptions"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { inputCls } from "../../../../../shared/lib/input-class"
import { parseIntInput } from "../../../../../shared/lib/parse-int-input"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import {
  sameData,
  useDirtyGuard,
} from "../../../../../shared/lib/use-dirty-guard"
import { formatAmount } from "../../../../../features/subscriptions/subscription-display"
import {
  ALL_DIRECTIONS,
  DirectionFilter,
} from "../../../../../features/directions/DirectionFilter"
import {
  DirectionScopeChips,
  DirectionScopePicker,
} from "../../../../../features/directions/DirectionScopePicker"
import { matchesScopeFilter } from "../../../../../features/directions/direction-scope"
import { useDirections } from "../../../../../features/directions/use-directions"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { agree, fromFirstSession } from "@clubspace/ui-kit/brand"

export default function WorkspaceSubscriptionsPage() {
  const vocabulary = useVocabulary()
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
  const [startsOnFirstVisit, setStartsOnFirstVisit] = useState(false)
  const [purchasableOnline, setPurchasableOnline] = useState(false)
  // Empty = «Весь клуб».
  const [directionIds, setDirectionIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const { directions } = useDirections(workspaceId)
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)
  const visiblePlans = plans.filter((p) =>
    matchesScopeFilter(
      directionFilter,
      p.directions.map((d) => d.id),
    ),
  )

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const plansRes = await listPlans({ workspaceId, includeInactive: true })
      setPlans(plansRes.data)
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

  // ?edit=<planId> — «Редактировать» on the tariff page — opens that tariff
  // in the form once the list is in. Read from window (not useSearchParams)
  // to avoid a Suspense boundary.
  useEffect(() => {
    if (loading) return
    const url = new URL(window.location.href)
    const id = url.searchParams.get("edit")
    if (!id) return
    url.searchParams.delete("edit")
    window.history.replaceState(window.history.state, "", url)
    const plan = plans.find((p) => p.id === id)
    if (plan) startEdit(plan)
    // startEdit only sets form state; re-running on its identity would
    // reopen the form after every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, plans])

  const resetForm = () => {
    setEditingId(null)
    setName("")
    setPrice("")
    setCurrency("RUB")
    setDurationDays("30")
    setClassCount("")
    setIsFreeTrial(false)
    setStartsOnFirstVisit(false)
    setPurchasableOnline(false)
    setDirectionIds([])
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
    setPurchasableOnline(p.purchasableOnline)
    setDirectionIds(p.directions.map((d) => d.id))
    setFieldErrors({})
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // The form is dirty while it differs from what it opened with: the tariff
  // being edited, or the blank new-tariff form. A new tariff's scope alone
  // does not count — its default arrives with the membership, after mount.
  const editingPlan = editingId
    ? plans.find((p) => p.id === editingId)
    : undefined
  const savedForm = editingPlan
    ? {
        name: editingPlan.name,
        price: String(editingPlan.price),
        currency: editingPlan.currency,
        durationDays: String(editingPlan.durationDays),
        classCount:
          editingPlan.classCount != null ? String(editingPlan.classCount) : "",
        isFreeTrial: editingPlan.isFreeTrial,
        startsOnFirstVisit: editingPlan.startsOnFirstVisit,
        purchasableOnline: editingPlan.purchasableOnline,
        directionIds: editingPlan.directions.map((d) => d.id).sort(),
      }
    : {
        name: "",
        price: "",
        currency: "RUB",
        durationDays: "30",
        classCount: "",
        isFreeTrial: false,
        startsOnFirstVisit: false,
        purchasableOnline: false,
        directionIds: [...directionIds].sort(),
      }
  useDirtyGuard(
    !sameData(
      {
        name,
        price,
        currency,
        durationDays,
        classCount,
        isFreeTrial,
        startsOnFirstVisit,
        purchasableOnline,
        directionIds: [...directionIds].sort(),
      },
      savedForm,
    ),
  )

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
      // The server refuses online sale for a free plan; drop the flag instead
      // of failing when the admin turns a paid online plan into a free one.
      purchasableOnline: purchasableOnline && parsedPrice > 0 && !isFreeTrial,
      directionIds,
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
      if (editingId === p.id) resetForm()
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось удалить тариф"))
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Задайте тарифы клуба. Абонемент назначается в карточке ученика
        (раздел «Ученики»); кому пора продлить — в «Удержание» → «Продлить».
      </p>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
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
          Срок считается {fromFirstSession(vocabulary)}
        </label>
        <p className="-mt-2 text-xs text-muted-foreground sm:col-span-5">
          Абонемент начнётся в день первой отметки, но не позже чем через 14
          дней после покупки
        </p>
        <label className="flex items-center gap-2 text-sm sm:col-span-5">
          <input
            type="checkbox"
            checked={purchasableOnline && !isFreeTrial && price.trim() !== "0"}
            disabled={isFreeTrial || price.trim() === "0"}
            onChange={(e) => setPurchasableOnline(e.target.checked)}
          />
          Можно купить онлайн
        </label>
        <p className="-mt-2 text-xs text-muted-foreground sm:col-span-5">
          Участник сможет оплатить тариф в приложении, если в разделе{" "}
          <Link
            href={`/workspace/${workspaceId}/settings/payments`}
            className="underline underline-offset-2"
          >
            «Настройки → Оплата»
          </Link>{" "}
          подключена касса. Бесплатные и пробные тарифы онлайн не продаются.
        </p>
        {directions.length > 0 && (
          <div className="sm:col-span-5">
            <DirectionScopePicker
              directions={directions}
              value={directionIds}
              onChange={setDirectionIds}
              hint={`Абонемент по направлениям списывает занятия только с ${vocabulary.session.genPl} выбранных направлений. «Весь клуб» — с любых ${vocabulary.session.genPl}.`}
            />
          </div>
        )}
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

      {plans.length > 0 && directions.length > 0 && (
        <div className="flex justify-end">
          <DirectionFilter
            directions={directions}
            value={directionFilter}
            onChange={setDirectionFilter}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">Тарифов пока нет.</p>
      ) : visiblePlans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Нет тарифов в выбранном направлении.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {visiblePlans.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/workspace/${workspaceId}/subscriptions/plans/${p.id}`}
                    className="font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                  <DirectionScopeChips directions={p.directions} />
                  {p.isFreeTrial && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                      Пробное
                    </span>
                  )}
                  {p.startsOnFirstVisit && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                      с 1-{agree(vocabulary.session, "й", "го")} {vocabulary.session.gen}
                    </span>
                  )}
                  {p.purchasableOnline && (
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700">
                      Онлайн
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
                    ? `${p.classCount} ${pluralRu(p.classCount, "занятие", "занятия", "занятий")}`
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
