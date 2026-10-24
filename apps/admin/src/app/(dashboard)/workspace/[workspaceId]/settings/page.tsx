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

// App-section feature flags shown in the "Разделы приложения" card. Each key is
// a Boolean field on the workspace settings; the mobile app hides the matching
// block when it's off.
type AppSectionKey =
  | "announcementsEnabled"
  | "ranksEnabled"
  | "leaderboardEnabled"
  | "attendanceEnabled"
  | "subscriptionEnabled"
  | "scheduleEnabled"
  | "groupsEnabled"
  | "eventsEnabled"

const APP_SECTIONS: Array<{
  key: AppSectionKey
  label: string
  description: string
}> = [
  {
    key: "announcementsEnabled",
    label: "Анонсы",
    description: "Лента новостей и объявлений клуба.",
  },
  {
    key: "ranksEnabled",
    label: "Ранги и пояса",
    description: "Прогресс ученика по поясам/грейдам.",
  },
  {
    key: "leaderboardEnabled",
    label: "Рейтинг посещаемости",
    description: "Таблица учеников по числу тренировок за неделю/месяц.",
  },
  {
    key: "attendanceEnabled",
    label: "Посещаемость",
    description: "История посещений ученика.",
  },
  {
    key: "subscriptionEnabled",
    label: "Абонемент",
    description: "Остаток занятий и статус абонемента.",
  },
  {
    key: "scheduleEnabled",
    label: "Расписание",
    description: "Расписание тренировок клуба.",
  },
  {
    key: "groupsEnabled",
    label: "Группы и залы",
    description: "Группы ученика и список залов клуба.",
  },
  {
    key: "eventsEnabled",
    label: "События",
    description: "Семинары, сборы и турниры.",
  },
]

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [settings, setSettings] = useState<WorkspaceSettings | null>(null)
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

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <p className="text-sm text-muted-foreground">Настройки воркспейса.</p>
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
            <Button
              type="button"
              size="sm"
              variant={settings.coachSeesAllGroups ? "default" : "secondary"}
              disabled={saving}
              onClick={() =>
                void handleToggleScope(!settings.coachSeesAllGroups)
              }
            >
              {settings.coachSeesAllGroups ? "Видят всех" : "Только свою"}
            </Button>
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
              const on = settings[section.key]
              return (
                <li
                  key={section.key}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{section.label}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {section.description}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={on ? "default" : "secondary"}
                    disabled={saving}
                    onClick={() => void handleToggleFlag(section.key, !on)}
                  >
                    {on ? "Включён" : "Выключен"}
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
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
          <Label>IANA tz</Label>
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
