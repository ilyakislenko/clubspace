"use client"

import { useEffect, useState } from "react"

import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  createDirection,
  updateDirection,
  type Direction,
} from "../../shared/api/directions"
import { errorMessage } from "../../shared/lib/error-message"
import { parseIntInput } from "../../shared/lib/parse-int-input"

const PRESET_COLORS = [
  "#2563EB",
  "#DC2626",
  "#16A34A",
  "#F59E0B",
  "#9333EA",
  "#0891B2",
  "#DB2777",
  "#475569",
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

type Props = {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // null = create mode.
  direction: Direction | null
  // Default `order` for a new direction (after the last one).
  nextOrder: number
  onSaved: () => void
}

export function DirectionFormSheet({
  workspaceId,
  open,
  onOpenChange,
  direction,
  nextOrder,
  onSaved,
}: Props) {
  const isCreate = !direction
  const [name, setName] = useState("")
  const [color, setColor] = useState("")
  const [icon, setIcon] = useState("")
  const [order, setOrder] = useState("0")
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  // Re-initialise every time the sheet opens, from the edited row or blank.
  useEffect(() => {
    if (!open) return
    setName(direction?.name ?? "")
    setColor(direction?.color ?? PRESET_COLORS[0])
    setIcon(direction?.icon ?? "")
    setOrder(String(direction?.order ?? nextOrder))
    setIsActive(direction?.isActive ?? true)
    setError("")
  }, [open, direction, nextOrder])

  const colorValid = color.trim() === "" || HEX_RE.test(color.trim())

  const handleSubmit = async () => {
    if (!name.trim()) return
    if (!colorValid) {
      setError("Цвет в формате #RRGGBB")
      return
    }
    const parsedOrder = parseIntInput(order, { min: 0, max: 10000 })
    if (parsedOrder === null) {
      setError("Порядок — целое число от 0")
      return
    }
    setSaving(true)
    setError("")
    const data = {
      name: name.trim(),
      color: color.trim() ? color.trim().toUpperCase() : null,
      icon: icon.trim() || null,
      order: parsedOrder,
      isActive,
    }
    try {
      if (direction) {
        await updateDirection({ workspaceId, directionId: direction.id, data })
      } else {
        await createDirection({ workspaceId, data })
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить направление"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {isCreate ? "Новое направление" : "Редактировать направление"}
          </SheetTitle>
          <SheetDescription>
            Направление — дисциплина внутри клуба (БЖЖ, ММА, тайский бокс…).
            Группы, ранги, тарифы и события можно привязать к нему.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-[80px,1fr]">
            <div className="space-y-2">
              <Label htmlFor="direction-icon">Эмодзи</Label>
              <Input
                id="direction-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🥋"
                maxLength={8}
                className="text-center text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="direction-name">Название</Label>
              <Input
                id="direction-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="БЖЖ"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="direction-color">Цвет</Label>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Цвет ${c}`}
                  onClick={() => setColor(c)}
                  className={`size-7 rounded-full border-2 ${
                    color.toUpperCase() === c
                      ? "border-foreground"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Выбрать цвет"
                value={HEX_RE.test(color) ? color : "#000000"}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                className="h-9 w-12 cursor-pointer rounded-md border border-border bg-background"
              />
              <Input
                id="direction-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#RRGGBB"
                className="w-32 font-mono"
              />
              {color && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setColor("")}
                >
                  Без цвета
                </Button>
              )}
            </div>
            {!colorValid && (
              <p className="text-xs text-destructive">Цвет в формате #RRGGBB</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="direction-order">Порядок</Label>
            <Input
              id="direction-order"
              type="number"
              min={0}
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              className="w-28"
            />
            <p className="text-xs text-muted-foreground">
              Меньше — выше в списках.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Активно
            <span className="text-xs text-muted-foreground">
              (архивное направление не предлагается в новых формах)
            </span>
          </label>

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
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving || !name.trim() || !colorValid}
            >
              {saving
                ? "Сохраняем…"
                : isCreate
                  ? "Создать направление"
                  : "Сохранить"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
