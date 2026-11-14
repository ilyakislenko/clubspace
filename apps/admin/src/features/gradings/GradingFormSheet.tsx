"use client"

import { useEffect, useState } from "react"

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import { createRankGrading } from "../../shared/api/gradings"
import type { Gym } from "../../shared/api/groups"
import type { RankLadder } from "../../shared/api/ranks"
import { errorMessage } from "../../shared/lib/error-message"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { confirmLeave, sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"

// Radix Select has no empty value: this stands for «зал не указан».
const NO_GYM = "none"

type Props = {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // Active ladders only: a grading is never scheduled on an archived one.
  ladders: RankLadder[]
  gyms: Gym[]
  onSaved: () => void
}

// «Новая аттестация»: date, ladder, optional title, gym and entry fee.
export function GradingFormSheet({
  workspaceId,
  open,
  onOpenChange,
  ladders,
  gyms,
  onSaved,
}: Props) {
  const [date, setDate] = useState("")
  const [ladderId, setLadderId] = useState("")
  const [title, setTitle] = useState("")
  const [gymId, setGymId] = useState(NO_GYM)
  const [fee, setFee] = useState("")
  const [currency, setCurrency] = useState("RUB")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  // Re-initialise every time the sheet opens.
  useEffect(() => {
    if (!open) return
    setDate("")
    setLadderId(ladders[0]?.id ?? "")
    setTitle("")
    setGymId(NO_GYM)
    setFee("")
    setCurrency("RUB")
    setError("")
  }, [open, ladders])

  // Closing with something typed asks first (the same prompt as leaving the
  // page). The default ladder alone is not a change.
  const blank = {
    date: "",
    ladderId: ladders[0]?.id ?? "",
    title: "",
    gymId: NO_GYM,
    fee: "",
    currency: "RUB",
  }
  const dirty = open && !sameData({ date, ladderId, title, gymId, fee, currency }, blank)
  useDirtyGuard(dirty)
  const requestClose = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }

  const handleSubmit = async () => {
    if (!date || !ladderId) return
    let feeAmount: number | undefined
    if (fee.trim()) {
      const parsed = parseIntInput(fee, { min: 0, max: 10_000_000 })
      if (parsed === null) {
        setError("Взнос — целое число")
        return
      }
      feeAmount = parsed
    }
    setSaving(true)
    setError("")
    try {
      await createRankGrading({
        workspaceId,
        data: {
          ladderId,
          date,
          title: title.trim() || undefined,
          gymId: gymId === NO_GYM ? undefined : gymId,
          feeAmount,
          feeCurrency:
            feeAmount !== undefined ? currency.trim().toUpperCase() : undefined,
        },
      })
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err, "Не удалось создать аттестацию"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Новая аттестация</SheetTitle>
          <SheetDescription>
            Кандидатов добавляют из списка «Готовы» выше, результаты отмечают на
            странице аттестации.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="grading-date">Дата</Label>
              <Input
                id="grading-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grading-ladder">Лестница</Label>
              <Select value={ladderId} onValueChange={setLadderId}>
                <SelectTrigger id="grading-ladder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ladders.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="grading-title">Название (необязательно)</Label>
            <Input
              id="grading-title"
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Весенняя аттестация"
            />
          </div>

          {gyms.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="grading-gym">Зал</Label>
              <Select value={gymId} onValueChange={setGymId}>
                <SelectTrigger id="grading-gym">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GYM}>Не указан</SelectItem>
                  {gyms.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr,96px]">
            <div className="space-y-2">
              <Label htmlFor="grading-fee">Взнос (необязательно)</Label>
              <Input
                id="grading-fee"
                inputMode="numeric"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
            </div>
            {fee.trim() && (
              <div className="space-y-2">
                <Label htmlFor="grading-currency">Валюта</Label>
                <Input
                  id="grading-currency"
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

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
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving || !date || !ladderId}
            >
              {saving ? "Сохраняем…" : "Создать аттестацию"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
