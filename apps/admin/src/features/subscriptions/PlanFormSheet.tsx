"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"
import { fromFirstSession } from "@clubspace/ui-kit/brand"

import {
  createPlan,
  updatePlan,
  type Plan,
} from "../../shared/api/subscriptions"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import {
  confirmLeave,
  sameData,
  useDirtyGuard,
} from "../../shared/lib/use-dirty-guard"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { type Direction } from "../../shared/api/directions"
import { DirectionScopePicker } from "../directions/DirectionScopePicker"

type Form = {
  name: string
  price: string
  currency: string
  durationDays: string
  classCount: string
  isFreeTrial: boolean
  startsOnFirstVisit: boolean
  purchasableOnline: boolean
  // Empty = «Весь клуб».
  directionIds: string[]
}

const BLANK: Form = {
  name: "",
  price: "",
  currency: "RUB",
  durationDays: "30",
  classCount: "",
  isFreeTrial: false,
  startsOnFirstVisit: false,
  purchasableOnline: false,
  directionIds: [],
}

const formOf = (plan: Plan): Form => ({
  name: plan.name,
  price: String(plan.price),
  currency: plan.currency,
  durationDays: String(plan.durationDays),
  classCount: plan.classCount != null ? String(plan.classCount) : "",
  isFreeTrial: plan.isFreeTrial,
  startsOnFirstVisit: plan.startsOnFirstVisit,
  purchasableOnline: plan.purchasableOnline,
  directionIds: plan.directions.map((d) => d.id),
})

// «Добавить тариф» / «Изменить» in a side panel. `plan` null = a new tariff.
// While the form differs from what it opened with, leaving the page asks first
// (the dirty guard) and so does closing the panel.
export function PlanFormSheet({
  workspaceId,
  open,
  onOpenChange,
  plan,
  directions,
  onSaved,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: Plan | null
  directions: Direction[]
  onSaved: () => void
}) {
  const vocabulary = useVocabulary()
  const [form, setForm] = useState<Form>(BLANK)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Re-initialise every time the panel opens, from the edited tariff or blank.
  useEffect(() => {
    if (!open) return
    setForm(plan ? formOf(plan) : BLANK)
    setFieldErrors({})
    setError(null)
  }, [open, plan])

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  // A new tariff's scope alone does not count — the picker may preset it.
  const saved = plan ? formOf(plan) : { ...BLANK, directionIds: form.directionIds }
  const dirty =
    open &&
    !sameData(
      { ...form, directionIds: [...form.directionIds].sort() },
      { ...saved, directionIds: [...saved.directionIds].sort() },
    )
  useDirtyGuard(dirty)

  // Closing a changed panel asks the dirty guard's own question.
  const requestClose = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    const parsedPrice = parseIntInput(form.price, { min: 0, max: 100_000_000 })
    if (parsedPrice === null)
      errs.price = "Введите цену целым числом (0 — бесплатно)"
    const parsedDays = parseIntInput(form.durationDays, { min: 1, max: 3650 })
    if (parsedDays === null)
      errs.durationDays = "Введите число дней от 1 до 3650"
    const parsedClasses = form.classCount.trim()
      ? parseIntInput(form.classCount, { min: 1, max: 1000 })
      : null
    if (form.classCount.trim() && parsedClasses === null)
      errs.classCount = "Введите число занятий от 1 до 1000 или оставьте пустым"
    const cur = form.currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(cur)) errs.currency = "Код из 3 букв, например RUB"
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0 || parsedPrice === null || parsedDays === null)
      return
    const data = {
      name: form.name.trim(),
      price: parsedPrice,
      currency: cur,
      durationDays: parsedDays,
      classCount: parsedClasses,
      isFreeTrial: form.isFreeTrial,
      startsOnFirstVisit: form.startsOnFirstVisit,
      // The server refuses online sale for a free plan; drop the flag instead
      // of failing when the admin turns a paid online plan into a free one.
      purchasableOnline:
        form.purchasableOnline && parsedPrice > 0 && !form.isFreeTrial,
      directionIds: form.directionIds,
    }
    setSaving(true)
    setError(null)
    try {
      if (plan) {
        await updatePlan({ workspaceId, planId: plan.id, data })
      } else {
        await createPlan({ workspaceId, data })
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(
        errorMessage(
          err,
          plan ? "Не удалось сохранить тариф" : "Не удалось создать тариф",
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (key: string) =>
    fieldErrors[key] && (
      <span className="block text-xs text-destructive">{fieldErrors[key]}</span>
    )
  const freeOrTrial = form.isFreeTrial || form.price.trim() === "0"

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}
    >
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{plan ? "Изменить тариф" : "Новый тариф"}</SheetTitle>
          <SheetDescription className="sr-only">
            Название, цена, срок и число занятий тарифа
          </SheetDescription>
        </SheetHeader>

        <form
          id="plan-form"
          onSubmit={handleSubmit}
          className="grid flex-1 grid-cols-1 content-start gap-3 overflow-y-auto sm:grid-cols-2"
        >
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs text-muted-foreground">Название</span>
            <input
              className={`${inputCls} w-full`}
              placeholder="Например, «Безлимит месяц»"
              maxLength={255}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Цена</span>
            <input
              className={`${inputCls} w-full`}
              placeholder="0"
              inputMode="numeric"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
            />
            {fieldError("price")}
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Валюта</span>
            <input
              className={`${inputCls} w-full`}
              maxLength={3}
              value={form.currency}
              onChange={(e) => set("currency", e.target.value)}
            />
            {fieldError("currency")}
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Дней доступа</span>
            <input
              className={`${inputCls} w-full`}
              inputMode="numeric"
              value={form.durationDays}
              onChange={(e) => set("durationDays", e.target.value)}
            />
            {fieldError("durationDays")}
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">
              Занятий (пусто — безлимит)
            </span>
            <input
              className={`${inputCls} w-full`}
              inputMode="numeric"
              value={form.classCount}
              onChange={(e) => set("classCount", e.target.value)}
            />
            {fieldError("classCount")}
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.isFreeTrial}
              onChange={(e) => set("isFreeTrial", e.target.checked)}
            />
            Первое бесплатное занятие (один раз на ученика)
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.startsOnFirstVisit}
              onChange={(e) => set("startsOnFirstVisit", e.target.checked)}
            />
            Срок считается {fromFirstSession(vocabulary)}
          </label>
          <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">
            Абонемент начнётся в день первой отметки, но не позже чем через 14
            дней после покупки
          </p>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.purchasableOnline && !freeOrTrial}
              disabled={freeOrTrial}
              onChange={(e) => set("purchasableOnline", e.target.checked)}
            />
            Можно купить онлайн
          </label>
          <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">
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
            <div className="sm:col-span-2">
              <DirectionScopePicker
                directions={directions}
                value={form.directionIds}
                onChange={(ids) => set("directionIds", ids)}
                hint={`Абонемент по направлениям списывает занятия только с ${vocabulary.session.genPl} выбранных направлений. «Весь клуб» — с любых ${vocabulary.session.genPl}.`}
              />
            </div>
          )}
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
        </form>

        <SheetFooter>
          <div className="flex w-full items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void requestClose()}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              form="plan-form"
              disabled={saving || !form.name.trim()}
            >
              {saving ? "Сохранение…" : plan ? "Сохранить" : "Добавить тариф"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
