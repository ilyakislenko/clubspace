"use client"

import { useState, type FormEvent } from "react"

import { Button, Input, Label } from "@clubspace/ui-kit/ui"

import { TimezoneSelect } from "../settings/TimezoneSelect"

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
  // "" = as the club: the column stays NULL on the row.
  const [timezone, setTimezone] = useState<string>(initial?.timezone ?? "")

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !address.trim()) return
    void onSubmit({
      name: name.trim(),
      address: address.trim(),
      timezone: timezone || null,
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
        <Label htmlFor="gym-timezone">Часовой пояс зала</Label>
        <TimezoneSelect
          id="gym-timezone"
          value={timezone}
          onChange={setTimezone}
          emptyLabel="Как у клуба (по умолчанию)"
        />
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
