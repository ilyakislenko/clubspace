"use client"

import { useParams } from "next/navigation"
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
} from "@clubspace/ui-kit/ui"

import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
  type WorkspaceSettings,
  type WorkspaceSettingsPatch,
} from "../../../../../shared/api/workspaces"
import {
  downloadExport,
  type ExportKind,
} from "../../../../../shared/api/exports"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { parseIntInput } from "../../../../../shared/lib/parse-int-input"
import { ClubAboutSection } from "../../../../../features/club-about/ClubAboutSection"
import { formatDay } from "../../../../../features/billing/billing-view"
import {
  APP_SECTIONS,
  type AppSectionFeature,
} from "../../../../../features/settings/app-sections"

type AppSectionKey = `${AppSectionFeature}Enabled`

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [settings, setSettings] = useState<WorkspaceSettings | null>(null)
  // Read once from GET: the PATCH response does not carry the entitlement.
  const [videoEntitled, setVideoEntitled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  // Date range for the attendance/revenue exports (members is a full snapshot).
  const [exportFrom, setExportFrom] = useState("")
  const [exportTo, setExportTo] = useState("")
  const [error, setError] = useState<string | null>(null)

  const handleExport = async (kind: ExportKind) => {
    if (!workspaceId) return
    setExporting(kind)
    setError(null)
    try {
      await downloadExport({
        workspaceId,
        kind,
        ...(kind === "members"
          ? {}
          : { from: exportFrom || undefined, to: exportTo || undefined }),
      })
    } catch (err) {
      setError(errorMessage(err, "Не удалось выгрузить данные"))
    } finally {
      setExporting(null)
    }
  }

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const data = await getWorkspaceSettings({ workspaceId })
        if (cancelled) return
        setSettings(data)
        setVideoEntitled(data.videoModuleEntitled)
      } catch (err) {
        // Silently swallow 403 — coaches don't need to see admin
        // settings, but should still see the roadmap below.
        if (
          err instanceof Error &&
          /403|forbidden/i.test(err.message ?? "")
        ) {
          setSettings(null)
        } else {
          setError(
            errorMessage(err, "Не удалось загрузить настройки"),
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  // «Тренеры могут отмечать в чужих группах без замены».
  const handleToggleMarkAny = async (next: boolean) => {
    if (!workspaceId || !settings) return
    setSaving(true)
    setError(null)
    try {
      setSettings(
        await updateWorkspaceSettings({ workspaceId, coachesMarkAnyClass: next }),
      )
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleScope = async (next: boolean) => {
    if (!workspaceId || !settings) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateWorkspaceSettings({
        workspaceId,
        coachSeesAllGroups: next,
      })
      setSettings(updated)
    } catch (err) {
      setError(
        errorMessage(err, "Не удалось сохранить"),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleToggleFlag = async (key: AppSectionKey, next: boolean) => {
    if (!workspaceId || !settings) return
    setSaving(true)
    setError(null)
    try {
      const patch: WorkspaceSettingsPatch = {}
      patch[key] = next
      const updated = await updateWorkspaceSettings({ workspaceId, ...patch })
      setSettings(updated)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveTimezone = async (next: string) => {
    if (!workspaceId || !settings) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateWorkspaceSettings({
        workspaceId,
        timezone: next,
      })
      setSettings(updated)
    } catch (err) {
      setError(
        errorMessage(err, "Не удалось сохранить часовой пояс"),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSaveBooking = async (patch: WorkspaceSettingsPatch) => {
    if (!workspaceId || !settings) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateWorkspaceSettings({ workspaceId, ...patch })
      setSettings(updated)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить настройки записи"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <p className="text-sm text-muted-foreground">Настройки клуба.</p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg border border-border bg-muted" />
      ) : settings ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">Видимость для тренеров</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Если выключено — тренеры видят только свои группы и учеников
                из них. Если включено — все тренеры видят всех учеников и
                все группы клуба, но редактировать могут только свои.
              </p>
            </div>
            <SettingSwitch
              checked={settings.coachSeesAllGroups}
              disabled={saving}
              label="Тренеры видят всех учеников и все группы"
              onChange={(next) => void handleToggleScope(next)}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-4">
            <div className="min-w-0 flex-1">
              <div className="font-medium">Отметки в чужих группах</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Если выключено — тренер отмечает посещаемость только в своих
                группах и в занятиях, где ему одобрили замену. Главный тренер
                и администраторы отмечают в любой группе всегда.
              </p>
            </div>
            <SettingSwitch
              checked={settings.coachesMarkAnyClass}
              disabled={saving}
              label="Тренеры могут отмечать в чужих группах без замены"
              onChange={(next) => void handleToggleMarkAny(next)}
            />
          </div>
        </div>
      ) : null}

      {settings && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="min-w-0">
            <div className="font-medium">Разделы приложения</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Скрывайте разделы, которые пока усложняют приложение. Выключенный
              раздел пропадает из мобильного приложения у всех участников
              (изменения применяются при следующем запуске приложения).
            </p>
          </div>

          <ul className="mt-4 divide-y divide-border">
            {APP_SECTIONS.map((section) => {
              const key: AppSectionKey = `${section.feature}Enabled`
              const on = settings[key]
              // Without the VIDEO module the section can only be switched off.
              const locked = section.feature === "videos" && !videoEntitled
              // Pinned from the platform console: the club cannot change it.
              const pinned = settings.lockedFeatures.find(
                (l) => l.feature === section.feature,
              )
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{section.label}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {section.description}
                    </p>
                    {pinned ? (
                      <p className="mt-1 text-xs text-sky-700">
                        Установлено платформой
                        {pinned.until ? ` до ${formatDay(pinned.until)}` : ""}
                      </p>
                    ) : (
                      locked && (
                        <p className="mt-1 text-xs text-amber-700">
                          Нужен модуль «Видео» — раздел «Тариф»
                        </p>
                      )
                    )}
                  </div>
                  <SettingSwitch
                    checked={on}
                    disabled={saving || Boolean(pinned) || (locked && !on)}
                    label={`Показывать раздел «${section.label}» в приложении${
                      pinned ? " — установлено платформой" : ""
                    }`}
                    onChange={(next) => void handleToggleFlag(key, next)}
                  />
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {settings && (
        <BookingSettings
          settings={settings}
          saving={saving}
          onSave={handleSaveBooking}
        />
      )}

      {settings && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-medium">Экспорт данных</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Выгрузка в CSV — открывается в Excel / Google Таблицах. Участники —
            контакты, роль, доступ и абонемент; Выручка — покупки абонементов
            для бухгалтерии. Период фильтрует посещаемость и выручку (участники —
            всегда полный список).
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">С</Label>
              <Input
                type="date"
                value={exportFrom}
                max={exportTo || undefined}
                onChange={(e) => setExportFrom(e.target.value)}
                className="h-9 w-[160px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">По</Label>
              <Input
                type="date"
                value={exportTo}
                min={exportFrom || undefined}
                onChange={(e) => setExportTo(e.target.value)}
                className="h-9 w-[160px]"
              />
            </div>
            {(exportFrom || exportTo) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9"
                onClick={() => {
                  setExportFrom("")
                  setExportTo("")
                }}
              >
                Сбросить период
              </Button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={exporting !== null}
              onClick={() => void handleExport("members")}
            >
              {exporting === "members" ? "Готовим…" : "Участники (CSV)"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={exporting !== null}
              onClick={() => void handleExport("renewals")}
            >
              {exporting === "renewals" ? "Готовим…" : "На продление (CSV)"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={exporting !== null}
              onClick={() => void handleExport("attendance")}
            >
              {exporting === "attendance" ? "Готовим…" : "Посещаемость (CSV)"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={exporting !== null}
              onClick={() => void handleExport("revenue")}
            >
              {exporting === "revenue" ? "Готовим…" : "Выручка (CSV)"}
            </Button>
          </div>
        </div>
      )}

      {workspaceId && <ClubAboutSection workspaceId={workspaceId} />}

      {settings && (
        <TimezoneSetting
          value={settings.timezone}
          saving={saving}
          onSave={handleSaveTimezone}
        />
      )}
    </div>
  )
}

// Accessible on/off switch. The visible caption lives next to the control in
// the markup above; `label` is the full sentence announced to screen readers.
function SettingSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-input"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block size-5 rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  )
}

// Club-wide rules for booking-mode groups («Запись на занятие»). Window and
// deadline can be overridden per group in the group form.
function BookingSettings({
  settings,
  saving,
  onSave,
}: {
  settings: WorkspaceSettings
  saving: boolean
  onSave: (patch: WorkspaceSettingsPatch) => void | Promise<void>
}) {
  const [windowDays, setWindowDays] = useState(String(settings.bookingWindowDays))
  const [cancelHours, setCancelHours] = useState(
    String(settings.bookingCancelHours),
  )

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

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="font-medium">Запись на занятия</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Правила для групп в режиме «Запись на занятие»: когда открывается
        запись, до какого момента можно отменить без последствий и списывать
        ли занятие с абонемента. Окно записи и срок отмены можно переопределить
        в карточке группы.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1">
          <Label htmlFor="booking-window-days">
            Запись открывается за (дней)
          </Label>
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
          <Label htmlFor="booking-cancel-hours">
            Бесплатная отмена за (часов)
          </Label>
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
        <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              Списывать занятие при поздней отмене
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Отмена позже срока бесплатной отмены забирает одно занятие из
              абонемента.
            </p>
          </div>
          <SettingSwitch
            checked={settings.bookingLateCancelBurn}
            disabled={saving}
            label="Списывать занятие при поздней отмене"
            onChange={(next) => void onSave({ bookingLateCancelBurn: next })}
          />
        </li>
        <li className="flex flex-wrap items-start justify-between gap-3 py-3 last:pb-0">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              Списывать занятие при неявке
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Записался, но не пришёл и не отменил — занятие списывается с
              абонемента.
            </p>
          </div>
          <SettingSwitch
            checked={settings.bookingNoShowBurn}
            disabled={saving}
            label="Списывать занятие при неявке"
            onChange={(next) => void onSave({ bookingNoShowBurn: next })}
          />
        </li>
      </ul>
    </div>
  )
}

const COMMON_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "Europe/Moscow", label: "Москва (MSK, UTC+3)" },
  { value: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { value: "Europe/Samara", label: "Самара (UTC+4)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { value: "Asia/Omsk", label: "Омск (UTC+6)" },
  { value: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
  { value: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { value: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { value: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { value: "Asia/Sakhalin", label: "Сахалин (UTC+11)" },
  { value: "Asia/Kamchatka", label: "Камчатка (UTC+12)" },
]

function TimezoneSetting({
  value,
  saving,
  onSave,
}: {
  value: string
  saving: boolean
  onSave: (next: string) => void | Promise<void>
}) {
  const [draft, setDraft] = useState(value)

  // Re-sync local draft when the persisted value changes (e.g. another
  // tab updated it). Without this the input would silently clobber the
  // remote update on the next "Сохранить" click.
  useEffect(() => {
    setDraft(value)
  }, [value])

  const dirty = draft.trim() !== value

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Часовой пояс клуба</div>
          <p className="mt-1 text-xs text-muted-foreground">
            В этом поясе хранятся слоты расписания. Если все ваши залы в
            Томске — выберите Asia/Krasnoyarsk. Когда у клуба появится
            филиал в другом городе — каждое расписание считается в своём
            поясе.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <Label>Часовой пояс клуба</Label>
          <Select value={draft} onValueChange={setDraft}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMON_TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            size="sm"
            disabled={saving || !dirty || !draft.trim()}
            onClick={() => void onSave(draft.trim())}
          >
            {saving ? "Сохраняем..." : "Сохранить"}
          </Button>
        </div>
      </div>
    </div>
  )
}
