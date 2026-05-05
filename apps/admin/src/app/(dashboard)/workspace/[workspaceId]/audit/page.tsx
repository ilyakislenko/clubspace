"use client"

import {
  FileVideo,
  ListVideo,
  LucideIcon,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserPlus,
  UserMinus,
  Activity,
  Pencil,
} from "lucide-react"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"

import {
  listAuditEvents,
  type AuditEvent,
} from "../../../../../shared/api/audit"

type ActionMeta = {
  label: string
  icon: LucideIcon
  tone: "blue" | "green" | "red" | "amber" | "zinc" | "indigo"
}

const ACTION_META: Record<string, ActionMeta> = {
  "video.startUpload": {
    label: "Загрузка видео начата",
    icon: UploadCloud,
    tone: "blue",
  },
  "video.completeUpload": {
    label: "Видео загружено",
    icon: FileVideo,
    tone: "green",
  },
  "video.update": {
    label: "Видео отредактировано",
    icon: Pencil,
    tone: "indigo",
  },
  "video.delete": { label: "Видео удалено", icon: Trash2, tone: "red" },
  "playlist.create": {
    label: "Курс создан",
    icon: ListVideo,
    tone: "green",
  },
  "playlist.update": {
    label: "Курс обновлён",
    icon: Pencil,
    tone: "indigo",
  },
  "playlist.delete": {
    label: "Курс удалён",
    icon: Trash2,
    tone: "red",
  },
  "member.add": {
    label: "Участник принят",
    icon: UserPlus,
    tone: "green",
  },
  "member.remove": {
    label: "Участник удалён",
    icon: UserMinus,
    tone: "red",
  },
  "member.updateAccess": {
    label: "Доступ участника изменён",
    icon: ShieldCheck,
    tone: "amber",
  },
  "member.updateRole": {
    label: "Роль участника изменена",
    icon: ShieldCheck,
    tone: "indigo",
  },
  "gym.create": { label: "Зал создан", icon: ListVideo, tone: "green" },
  "gym.delete": { label: "Зал удалён", icon: Trash2, tone: "red" },
  "group.create": { label: "Группа создана", icon: UserPlus, tone: "green" },
  "group.update": {
    label: "Группа отредактирована",
    icon: Pencil,
    tone: "indigo",
  },
  "group.delete": { label: "Группа удалена", icon: Trash2, tone: "red" },
  "group.addMember": {
    label: "Добавлен в группу",
    icon: UserPlus,
    tone: "green",
  },
  "group.removeMember": {
    label: "Удалён из группы",
    icon: UserMinus,
    tone: "amber",
  },
  "workspace.updateSettings": {
    label: "Настройки воркспейса",
    icon: ShieldCheck,
    tone: "indigo",
  },
  "content.report": {
    label: "Жалоба на контент",
    icon: Activity,
    tone: "amber",
  },
}

const TONE_CLASS: Record<ActionMeta["tone"], string> = {
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  zinc: "bg-zinc-100 text-zinc-700 ring-zinc-600/20",
}

const TARGET_LABEL: Record<string, string> = {
  video: "Видео",
  playlist: "Курс",
  member: "Участник",
  workspace: "Воркспейс",
}

const formatDate = (iso: string) => {
  const date = new Date(iso)
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const formatRelative = (iso: string): string | null => {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "только что"
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} дн назад`
  return null
}

const META_KEY_LABEL: Record<string, string> = {
  email: "Email",
  isNew: "Новый юзер",
  addedVideos: "Добавлено видео",
  movedVideo: "Перемещён",
  afterId: "После",
  beforeId: "До",
  accessUntil: "Доступ до",
}

const formatMetaValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "да" : "нет"
  if (Array.isArray(value)) {
    if (value.length === 0) return "—"
    return value.map((v) => formatMetaValue(v)).join(", ")
  }
  if (typeof value === "string") {
    if (/^[0-9a-f]{8}-/.test(value)) return value.slice(0, 8) + "…"
    return value
  }
  return JSON.stringify(value)
}

const parseMetadata = (
  metadata: unknown,
): Array<{ key: string; value: string }> => {
  if (!metadata || typeof metadata !== "object") return []
  return Object.entries(metadata as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({
      key: META_KEY_LABEL[k] ?? k,
      value: formatMetaValue(v),
    }))
}

export default function WorkspaceAuditPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage] = useState(50)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const response = await listAuditEvents({
          workspaceId,
          curPage: page,
          perPage,
        })
        if (cancelled) return
        setEvents(response.data)
        setTotal(response.total)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось загрузить журнал.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceId, page, perPage])

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, AuditEvent[]>()
    for (const event of events) {
      const date = new Date(event.createdAt)
      const key = date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
      const list = groups.get(key) ?? []
      list.push(event)
      groups.set(key, list)
    }
    return Array.from(groups.entries())
  }, [events])

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Журнал событий</h1>
        <p className="text-sm text-muted-foreground">
          Кто и что делал в клубе. Только владелец видит этот раздел.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      )}

      {!loading && events.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
          <Activity className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Событий пока нет</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Здесь появятся записи когда тренер начнёт что-то делать в клубе.
          </p>
        </div>
      )}

      {!loading && events.length > 0 && (
        <div className="space-y-6">
          {groupedByDay.map(([day, dayEvents]) => (
            <section key={day} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {day}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {dayEvents.map((event) => {
                  const meta =
                    ACTION_META[event.action] ??
                    ({
                      label: event.action,
                      icon: Activity,
                      tone: "zinc",
                    } as ActionMeta)
                  const Icon = meta.icon
                  const fields = parseMetadata(event.metadata)
                  const targetLabel =
                    TARGET_LABEL[event.targetType] ?? event.targetType
                  const relative = formatRelative(event.createdAt)
                  return (
                    <li
                      key={event.id}
                      className="flex gap-3 p-3 transition-colors hover:bg-muted/40"
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${TONE_CLASS[meta.tone]}`}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">
                            {meta.label}
                          </span>
                          <time
                            className="text-xs text-muted-foreground"
                            title={formatDate(event.createdAt)}
                          >
                            {relative ?? formatDate(event.createdAt)}
                          </time>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {event.actorLabel ??
                              event.actorEmail ??
                              (event.actorId
                                ? `actor: ${event.actorId.slice(0, 8)}…`
                                : "система")}
                          </span>
                          <span>·</span>
                          <span>
                            {targetLabel}
                            {event.targetLabel && (
                              <span className="ml-1 font-medium text-foreground">
                                «{event.targetLabel}»
                              </span>
                            )}
                          </span>
                        </div>
                        {fields.length > 0 && (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs">
                            {fields.map(({ key, value }) => (
                              <span
                                key={key}
                                className="text-muted-foreground"
                              >
                                <span className="text-foreground/60">
                                  {key}:
                                </span>{" "}
                                <span className="font-medium text-foreground/90">
                                  {value}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Страница {page} из {totalPages} · всего {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              ← Назад
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Вперёд →
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
