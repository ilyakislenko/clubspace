"use client"

import { useEffect, useState } from "react"

import { Button, Input, Label } from "@clubspace/ui-kit/ui"

import type {
  WorkspaceSettings,
  WorkspaceSettingsPatch,
} from "../../shared/api/workspaces"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { SettingRow, SettingSwitch } from "./SettingSwitch"

// Club-wide rules for booking-mode groups («Запись на тренировку/занятие»).
// Window and deadline can be overridden per group in the group form.
export function BookingSettings({
  settings,
  saving,
  onSave,
}: {
  settings: WorkspaceSettings
  saving: boolean
  onSave: (patch: WorkspaceSettingsPatch) => void | Promise<unknown>
}) {
  const session = useVocabulary().session
  const [windowDays, setWindowDays] = useState(String(settings.bookingWindowDays))
  const [cancelHours, setCancelHours] = useState(String(settings.bookingCancelHours))

  useEffect(() => {
    setWindowDays(String(settings.bookingWindowDays))
    setCancelHours(String(settings.bookingCancelHours))
  }, [settings.bookingWindowDays, settings.bookingCancelHours])

  const parsedWindow = parseIntInput(windowDays, { min: 0, max: 90 })
  const parsedCancel = parseIntInput(cancelHours, { min: 0, max: 168 })
  const dirty =
    parsedWindow !== settings.bookingWindowDays ||
    parsedCancel !== settings.bookingCancelHours
  const invalid = parsedWindow === null || parsedCancel === null
  useDirtyGuard(dirty)

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="font-medium">Запись на {session.nomPl}</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Правила для групп в режиме «Запись на {session.acc}»: когда открывается
        запись, до какого момента можно отменить без последствий и списывать
        ли занятие с абонемента. Окно записи и срок отмены можно переопределить
        в карточке группы.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1">
          <Label htmlFor="booking-window-days">Запись открывается за (дней)</Label>
          <Input
            id="booking-window-days"
            inputMode="numeric"
            value={windowDays}
            onChange={(e) => setWindowDays(e.target.value)}
            className="h-9"
          />
          {parsedWindow === null && (
            <p className="text-xs text-destructive">Целое число от 0 до 90</p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="booking-cancel-hours">Бесплатная отмена за (часов)</Label>
          <Input
            id="booking-cancel-hours"
            inputMode="numeric"
            value={cancelHours}
            onChange={(e) => setCancelHours(e.target.value)}
            className="h-9"
          />
          {parsedCancel === null && (
            <p className="text-xs text-destructive">Целое число от 0 до 168</p>
          )}
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            size="sm"
            disabled={saving || invalid || !dirty}
            onClick={() => {
              if (parsedWindow === null || parsedCancel === null) return
              void onSave({
                bookingWindowDays: parsedWindow,
                bookingCancelHours: parsedCancel,
              })
            }}
          >
            {saving ? "Сохраняем..." : "Сохранить"}
          </Button>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-border">
        <SettingRow
          title="Списывать занятие при поздней отмене"
          description="Отмена позже срока бесплатной отмены забирает одно занятие из абонемента."
        >
          <SettingSwitch
            checked={settings.bookingLateCancelBurn}
            disabled={saving}
            label="Списывать занятие при поздней отмене"
            onChange={(next) => void onSave({ bookingLateCancelBurn: next })}
          />
        </SettingRow>
        <SettingRow
          title="Списывать занятие при неявке"
          description="Записался, но не пришёл и не отменил — занятие списывается с абонемента."
        >
          <SettingSwitch
            checked={settings.bookingNoShowBurn}
            disabled={saving}
            label="Списывать занятие при неявке"
            onChange={(next) => void onSave({ bookingNoShowBurn: next })}
          />
        </SettingRow>
      </ul>
    </div>
  )
}
