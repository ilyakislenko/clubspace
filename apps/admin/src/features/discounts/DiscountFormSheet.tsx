"use client"

import { MoreHorizontal } from "lucide-react"
import { useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import {
  createDiscount,
  deleteDiscount,
  updateDiscount,
  type Discount,
  type DiscountInput,
  type DiscountKind,
} from "../../shared/api/discounts"
import type { Plan } from "../../shared/api/subscriptions"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { confirmLeave, sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { isStaleUpdate, StaleUpdateNotice } from "../../shared/ui/stale-update-notice"
import { currencySymbol } from "../subscriptions/subscription-display"
import { normalizePromoCode } from "./discount-view"

const L = FORM_LIMITS.discount
// CreateDiscountInput's superRefine: a percent is 1–100 (the contract carries
// only the field's overall bound, the fixed sum's).
const PERCENT = { min: 1, max: 100 }

type How = "staff" | "code" | "family"

type Form = {
  name: string
  kind: DiscountKind
  value: string
  currency: string
  how: How
  code: string
  allPlans: boolean
  planIds: string[]
  events: boolean
  startsOn: string
  endsOn: string
  maxUses: string
  oncePerMember: boolean
}

const blank = (currency: string): Form => ({
  name: "",
  kind: "PERCENT",
  value: "",
  currency,
  how: "staff",
  code: "",
  allPlans: true,
  planIds: [],
  events: false,
  startsOn: "",
  endsOn: "",
  maxUses: "",
  oncePerMember: false,
})

const formOf = (d: Discount, currency: string): Form => ({
  name: d.name,
  kind: d.kind,
  value: String(d.value),
  currency: d.currency ?? currency,
  how: d.isFamily ? "family" : d.code ? "code" : "staff",
  code: d.code ?? "",
  allPlans: d.allPlans,
  planIds: d.plans.map((p) => p.id),
  events: d.events,
  startsOn: d.startsOn ?? "",
  endsOn: d.endsOn ?? "",
  maxUses: d.maxUses !== null ? String(d.maxUses) : "",
  oncePerMember: d.oncePerMember,
})

// The currency the club sells in: the one most of its tariffs on sale use.
const clubCurrency = (plans: readonly Plan[]): string => {
  const counts = new Map<string, number>()
  for (const p of plans) if (p.isActive) counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "RUB"
}

// «Новая скидка» / an existing one in a side panel. While the form differs
// from what it opened with, leaving asks first (the dirty guard). «⋯» in the
// header archives, restores or deletes (only one nobody used yet).
export function DiscountFormSheet({
  workspaceId,
  open,
  discount,
  plans,
  activeFamily,
  onClose,
  onSaved,
  onReload,
}: {
  workspaceId: string
  open: boolean
  // null = a new discount.
  discount: Discount | null
  plans: readonly Plan[]
  // The club's active family discount, if any: a second one is refused.
  activeFamily: Discount | null
  onClose: () => void
  onSaved: () => void
  // «Обновить» after a 409: the stored discount, read again.
  onReload: (discountId: string) => Promise<Discount | null>
}) {
  const currency = clubCurrency(plans)
  const [form, setForm] = useState<Form>(blank(currency))
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Form | "scope", string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // The discount the form shows (and whose version a save sends).
  const [current, setCurrent] = useState<Discount | null>(discount)
  const [stale, setStale] = useState<unknown>(null)

  // Initialise at each opening; a newer `discount` while open (a realtime
  // reload) neither resets the draft nor hides someone else's save.
  useEffect(() => {
    if (!open) return
    setCurrent(discount)
    setForm(discount ? formOf(discount, currency) : blank(currency))
    setFieldErrors({})
    setError(null)
    setStale(null)
    // `discount` and `currency` are read at the opening edge, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const saved = current ? formOf(current, currency) : blank(currency)
  const dirty =
    open &&
    !sameData(
      { ...form, planIds: [...form.planIds].sort() },
      { ...saved, planIds: [...saved.planIds].sort() },
    )
  useDirtyGuard(dirty)

  const requestClose = async () => {
    if (await confirmLeave()) onClose()
  }

  // Two currencies on sale: a fixed sum says which one it is in.
  const currencies = [...new Set(plans.filter((p) => p.isActive).map((p) => p.currency))]
  // Tariffs on sale, plus an archived one the discount still names.
  const pickable = plans.filter((p) => p.isActive || form.planIds.includes(p.id))
  const familyTaken = activeFamily !== null && activeFamily.id !== current?.id

  const build = (): DiscountInput | null => {
    const errs: typeof fieldErrors = {}
    const name = form.name.trim()
    if (!name) errs.name = "Введите название"
    const range = form.kind === "PERCENT" ? PERCENT : L.value
    const value = parseIntInput(form.value, range)
    if (value === null)
      errs.value =
        form.kind === "PERCENT"
          ? `Процент — от ${PERCENT.min} до ${PERCENT.max}`
          : `Сумма — от ${L.value.min} до ${L.value.max.toLocaleString("ru-RU")}`
    const code = form.how === "code" ? normalizePromoCode(form.code) : null
    if (form.how === "code" && code === null)
      errs.code = "Промокод — от 3 до 32 букв, цифр или дефисов"
    if (!form.allPlans && form.planIds.length === 0 && !form.events)
      errs.scope = "Выберите, на что действует скидка"
    if (!form.allPlans && form.planIds.length > L.planIds.max)
      errs.scope = `Не больше ${L.planIds.max} тарифов`
    if (form.startsOn && form.endsOn && form.endsOn < form.startsOn)
      errs.endsOn = "Дата окончания раньше даты начала"
    const limited = form.how !== "family"
    const maxUses =
      limited && form.maxUses.trim() ? parseIntInput(form.maxUses, L.maxUses) : null
    if (limited && form.maxUses.trim() && maxUses === null)
      errs.maxUses = `От ${L.maxUses.min} до ${L.maxUses.max.toLocaleString("ru-RU")} или пусто`
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0 || value === null) return null
    return {
      name,
      kind: form.kind,
      value,
      currency: form.kind === "FIXED" ? form.currency : null,
      code,
      isFamily: form.how === "family",
      allPlans: form.allPlans,
      planIds: form.allPlans ? [] : form.planIds,
      events: form.events,
      startsOn: form.startsOn || null,
      endsOn: form.endsOn || null,
      maxUses,
      oncePerMember: limited && form.oncePerMember,
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const data = build()
    if (!data) return
    setSaving(true)
    setError(null)
    setStale(null)
    try {
      if (current) {
        await updateDiscount({
          workspaceId,
          discountId: current.id,
          data: { ...data, expectedUpdatedAt: current.updatedAt },
        })
      } else {
        await createDiscount({ workspaceId, data })
      }
      onSaved()
      onClose()
    } catch (err) {
      if (current && isStaleUpdate(err)) setStale(err)
      else
        setError(
          errorMessage(err, current ? "Не удалось сохранить скидку" : "Не удалось создать скидку"),
        )
    } finally {
      setSaving(false)
    }
  }

  const reload = async () => {
    if (!current) return
    try {
      const fresh = await onReload(current.id)
      if (!fresh) {
        onClose()
        return
      }
      setCurrent(fresh)
      setForm(formOf(fresh, currency))
      setFieldErrors({})
      setStale(null)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить скидку"))
    }
  }

  const toggleArchive = async () => {
    if (!current) return
    if (current.isActive) {
      const ok = await confirmDialog({
        title: `Убрать скидку «${current.name}» в архив?`,
        description:
          "Скидку больше нельзя будет выбрать при продаже, промокод перестанет действовать. Проданные абонементы не изменятся.",
        confirmLabel: "В архив",
      })
      if (!ok) return
    }
    setSaving(true)
    setError(null)
    try {
      await updateDiscount({
        workspaceId,
        discountId: current.id,
        data: { isActive: !current.isActive, expectedUpdatedAt: current.updatedAt },
      })
      onSaved()
      onClose()
    } catch (err) {
      if (isStaleUpdate(err)) setStale(err)
      else setError(errorMessage(err, "Не удалось изменить скидку"))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!current) return
    const ok = await confirmDialog({
      title: `Удалить скидку «${current.name}»?`,
      description: "Ею ещё не пользовались, удаление ничего не изменит в продажах.",
      destructive: true,
    })
    if (!ok) return
    setSaving(true)
    setError(null)
    try {
      await deleteDiscount({ workspaceId, discountId: current.id })
      onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err, "Не удалось удалить скидку"))
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (key: keyof typeof fieldErrors) =>
    fieldErrors[key] && <span className="block text-xs text-destructive">{fieldErrors[key]}</span>

  const togglePlan = (id: string, on: boolean) =>
    set("planIds", on ? [...form.planIds, id] : form.planIds.filter((p) => p !== id))

  return (
    <Sheet open={open} onOpenChange={(next) => !next && void requestClose()}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-start gap-2 pr-6">
            <SheetTitle className="flex-1">{current ? current.name : "Новая скидка"}</SheetTitle>
            {current && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={saving}
                    aria-label={`Действия со скидкой «${current.name}»`}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void toggleArchive()}>
                    {current.isActive ? "В архив" : "Вернуть из архива"}
                  </DropdownMenuItem>
                  {current.uses === 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => void remove()}
                      >
                        Удалить
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <SheetDescription className="sr-only">
            Название, размер, как применяется и на что действует скидка
          </SheetDescription>
        </SheetHeader>

        <form
          id="discount-form"
          onSubmit={submit}
          className="flex flex-1 flex-col gap-5 overflow-y-auto text-sm"
        >
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Название</span>
            <input
              className={`${inputCls} w-full`}
              placeholder="Например, «Студенческая»"
              maxLength={L.name.max}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
            {fieldError("name")}
          </label>

          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Размер</span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${inputCls} w-28`}
                inputMode="numeric"
                aria-label="Размер"
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
              />
              <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Процент или сумма">
                {(["PERCENT", "FIXED"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={form.kind === k}
                    className={cn(
                      "rounded px-3 py-1 text-sm",
                      form.kind === k ? "bg-muted font-medium" : "text-muted-foreground",
                    )}
                    onClick={() => set("kind", k)}
                  >
                    {k === "PERCENT" ? "%" : currencySymbol(form.currency)}
                  </button>
                ))}
              </div>
              {form.kind === "FIXED" && currencies.length > 1 && (
                <select
                  className={inputCls}
                  aria-label="Валюта"
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value)}
                >
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {fieldError("value")}
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs text-muted-foreground">Как применяется</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="discount-how"
                checked={form.how === "staff"}
                onChange={() => set("how", "staff")}
              />
              Выбирает сотрудник при продаже
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="discount-how"
                checked={form.how === "code"}
                onChange={() => set("how", "code")}
              />
              По промокоду
            </label>
            {form.how === "code" && (
              <div className="space-y-1 pl-6">
                <input
                  className={`${inputCls} w-48 uppercase`}
                  aria-label="Промокод"
                  placeholder="Промокод"
                  maxLength={L.code.max}
                  value={form.code}
                  onChange={(e) => set("code", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Ученик вводит его при оплате в приложении; сотрудник тоже может его выбрать
                </p>
                {fieldError("code")}
              </div>
            )}
            <label className={cn("flex items-center gap-2", familyTaken && "text-muted-foreground")}>
              <input
                type="radio"
                name="discount-how"
                checked={form.how === "family"}
                disabled={familyTaken}
                onChange={() => set("how", "family")}
              />
              Семейная — применяется сама
            </label>
            <p className="pl-6 text-xs text-muted-foreground">
              {familyTaken
                ? `В клубе уже есть семейная скидка «${activeFamily?.name}»`
                : "Если у родителя, ребёнка, брата или сестры ученика есть действующий абонемент"}
            </p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs text-muted-foreground">На что</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="discount-scope"
                checked={form.allPlans}
                onChange={() => set("allPlans", true)}
              />
              Все тарифы
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="discount-scope"
                checked={!form.allPlans}
                onChange={() => set("allPlans", false)}
              />
              Выбрать тарифы…
            </label>
            {!form.allPlans && (
              <div className="ml-6 max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {pickable.length === 0 ? (
                  <p className="text-xs text-muted-foreground">В клубе нет тарифов</p>
                ) : (
                  pickable.map((p) => (
                    <label key={p.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.planIds.includes(p.id)}
                        onChange={(e) => togglePlan(p.id, e.target.checked)}
                      />
                      <span className={cn(!p.isActive && "text-muted-foreground")}>
                        {p.name}
                        {!p.isActive ? " · в архиве" : ""}
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.events}
                onChange={(e) => set("events", e.target.checked)}
              />
              Платные события
            </label>
            {fieldError("scope")}
          </fieldset>

          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Срок</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">с</span>
              <input
                className={inputCls}
                type="date"
                aria-label="Начало"
                value={form.startsOn}
                max={form.endsOn || undefined}
                onChange={(e) => set("startsOn", e.target.value)}
              />
              <span className="text-muted-foreground">по</span>
              <input
                className={inputCls}
                type="date"
                aria-label="Окончание"
                value={form.endsOn}
                min={form.startsOn || undefined}
                onChange={(e) => set("endsOn", e.target.value)}
              />
            </div>
            {fieldError("endsOn")}
          </div>

          {form.how !== "family" && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs text-muted-foreground">Ограничения</legend>
              <label className="flex flex-wrap items-center gap-2">
                Не больше
                <input
                  className={`${inputCls} w-24`}
                  inputMode="numeric"
                  aria-label="Не больше раз всего"
                  value={form.maxUses}
                  onChange={(e) => set("maxUses", e.target.value)}
                />
                раз всего
              </label>
              {fieldError("maxUses")}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.oncePerMember}
                  onChange={(e) => set("oncePerMember", e.target.checked)}
                />
                Один раз на ученика
              </label>
            </fieldset>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </p>
          )}
          {stale !== null && <StaleUpdateNotice error={stale} onReload={reload} />}
        </form>

        {current && (
          <p className="text-xs text-muted-foreground">
            Изменения не затронут уже проданные абонементы
          </p>
        )}
        <SheetFooter>
          <div className="flex w-full items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => void requestClose()} disabled={saving}>
              Отмена
            </Button>
            <Button type="submit" form="discount-form" disabled={saving}>
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
