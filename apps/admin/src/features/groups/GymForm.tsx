"use client"

import { useState, type FormEvent } from "react"

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

// Common Russian timezones for the gym dropdown. Empty string means
// "use workspace default" (column stays NULL on the row).
const GYM_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "", label: "Как у клуба (по умолчанию)" },
  { value: "Europe/Moscow", label: "Москва (UTC+3)" },
  { value: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { value: "Europe/Samara", label: "Самара (UTC+4)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { value: "Asia/Omsk", label: "Омск (UTC+6)" },
  { value: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск / Томск (UTC+7)" },
  { value: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { value: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { value: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { value: "Asia/Sakhalin", label: "Сахалин (UTC+11)" },
  { value: "Asia/Kamchatka", label: "Камчатка (UTC+12)" },
]

// Sentinel string for "не задан" inside the Select, since shadcn Select
// rejects an empty-string value. We translate to/from null on the wire.
const NO_TZ = "__none__"

type Props = {
  initial?: { name: string; address: string; timezone: string | null }
  submitting: boolean
  title?: string
  submitLabel?: string
  onCancel: () => void
  onSubmit: (payload: {
    name: string
    address: string
    timezone: string | null
  }) => Promise<void>
}

export function GymForm({
  initial,
  submitting,
  title = "Новый зал",
  submitLabel = "Создать",
  onCancel,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "")
  const [address, setAddress] = useState(initial?.address ?? "")
  const [timezone, setTimezone] = useState<string>(initial?.timezone ?? NO_TZ)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !address.trim()) return
    void onSubmit({
      name: name.trim(),
      address: address.trim(),
      timezone: timezone === NO_TZ ? null : timezone,
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="gym-name">Название</Label>
          <Input
            id="gym-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Гладиатор"
            required
          />
        </div>
        <div>
          <Label htmlFor="gym-address">Адрес</Label>
          <Input
            id="gym-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Москва, Тимура Фрунзе 11"
            required
          />
        </div>
      </div>
      <div>
        <Label>Часовой пояс зала</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TZ}>{GYM_TIMEZONES[0].label}</SelectItem>
            {GYM_TIMEZONES.slice(1).map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          Слоты групп этого зала проектируются в выбранном поясе. Если оставить
          «Как у клуба» — берётся тот, что указан в Настройках.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Отмена
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Сохраняю…" : submitLabel}
        </Button>
      </div>
    </form>
  )
}
