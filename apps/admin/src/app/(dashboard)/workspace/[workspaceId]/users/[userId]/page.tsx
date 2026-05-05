"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bjj-academy/ui-kit/ui"

import {
  listRoles,
  updateMemberRole,
  type Role,
} from "../../../../../../shared/api/groups"
import { getMemberProgress, type MemberProgress } from "../../../../../../shared/api/members"
import {
  ACTIVITY_CHIP,
  ACTIVITY_LABEL,
  computeActivity,
  formatRelativeDays,
} from "../../../../../../shared/lib/member-activity"

const formatName = (m: MemberProgress["member"]): string => {
  const full = [m.firstname, m.lastname].filter(Boolean).join(" ").trim()
  return full || m.email
}

const formatPosition = (sec: number): string => {
  const total = Math.max(0, Math.floor(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

const formatAccessLabel = (iso: string | null): string => {
  if (!iso) return "Без ограничения"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Без ограничения"
  const expired = d < new Date()
  const fmt = d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  return expired ? `Истёк ${fmt}` : `Доступ до ${fmt}`
}

export default function MemberProgressPage() {
  const params = useParams<{ workspaceId: string; userId: string }>()
  const workspaceId = params?.workspaceId
  const userId = params?.userId

  const [data, setData] = useState<MemberProgress | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingRole, setSavingRole] = useState(false)

  useEffect(() => {
    if (!workspaceId || !userId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const [progress, rolesResp] = await Promise.all([
          getMemberProgress({ workspaceId, userId }),
          listRoles().catch(() => ({ data: [] as Role[] })),
        ])
        if (cancelled) return
        setData(progress)
        setRoles(rolesResp.data)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось загрузить профиль ученика.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceId, userId])

  const handleRoleChange = async (newRoleId: string) => {
    if (!workspaceId || !userId || !data) return
    if (newRoleId === data.member.roleId) return
    setSavingRole(true)
    setError(null)
    try {
      const result = await updateMemberRole({
        workspaceId,
        userId,
        roleId: newRoleId,
      })
      setData((prev) =>
        prev
          ? {
              ...prev,
              member: {
                ...prev.member,
                roleId: result.roleId,
                roleName: result.roleName,
              },
            }
          : prev,
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось обновить роль",
      )
    } finally {
      setSavingRole(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link
          href={`/workspace/${workspaceId}/users`}
          className="text-sm text-primary hover:underline"
        >
          ← Все ученики
        </Link>
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      </div>
    )
  }

  if (!data) return null

  const { member, summary, groups, courses, recentActivity } = data
  const activity = computeActivity(summary.lastWatchedAt)
  const completedPct =
    summary.totalVideos > 0
      ? Math.min(
          100,
          Math.round((summary.completedCount / summary.totalVideos) * 100),
        )
      : 0
  const accessExpired =
    member.accessUntil !== null && new Date(member.accessUntil) < new Date()

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href={`/workspace/${workspaceId}/users`}
          className="text-xs text-primary hover:underline"
        >
          ← Все ученики
        </Link>
        <h1 className="text-2xl font-semibold">{formatName(member)}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{member.email}</span>
          <span>·</span>
          <span className="uppercase">{member.status}</span>
          <span>·</span>
          <span className="capitalize">{member.roleName}</span>
          <span>·</span>
          <span
            className={
              accessExpired
                ? "font-medium text-destructive"
                : member.accessUntil
                  ? "text-foreground"
                  : ""
            }
          >
            {formatAccessLabel(member.accessUntil)}
          </span>
          <span>·</span>
          <span>
            добавлен{" "}
            {new Date(member.createdAt).toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      </div>

      {!member.isOwner && roles.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
          <div className="text-sm">
            <div className="font-medium">Роль в клубе</div>
            <div className="text-xs text-muted-foreground">
              Влияет на права в админке. Полная RBAC-проверка прилетит
              следующим PR — пока эта настройка тегирует пользователя.
            </div>
          </div>
          <div className="ml-auto w-56">
            <Select
              value={member.roleId}
              onValueChange={(v) => void handleRoleChange(v)}
              disabled={savingRole}
            >
              <SelectTrigger>
                <SelectValue placeholder="Роль" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 text-xs uppercase text-muted-foreground">
            Группы
          </div>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <Link
                key={`${g.role}-${g.id}`}
                href={`/workspace/${workspaceId}/groups`}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset hover:opacity-90 ${
                  g.role === "coach"
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                    : "bg-zinc-100 text-zinc-700 ring-zinc-600/20"
                }`}
                title={`${g.gym.name}${g.role === "coach" ? " · ведёт" : ""}`}
              >
                <span className="font-medium">{g.name}</span>
                <span className="text-[11px] opacity-70">·</span>
                <span className="text-[11px]">{g.gym.name}</span>
                {g.role === "coach" && (
                  <span className="text-[11px] font-semibold">тренер</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTIVITY_CHIP[activity]}`}
          >
            {ACTIVITY_LABEL[activity]}
          </span>
          {summary.lastWatchedAt && (
            <span className="text-sm text-muted-foreground">
              последняя активность {formatRelativeDays(summary.lastWatchedAt)}
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-6 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              Просмотрено
            </div>
            <div className="text-3xl font-semibold tabular-nums">
              {summary.completedCount}
              <span className="ml-2 text-base font-normal text-muted-foreground">
                из {summary.totalVideos}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width]"
                style={{ width: `${completedPct}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {completedPct}% курса
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              В процессе
            </div>
            <div className="text-3xl font-semibold tabular-nums">
              {summary.inProgressCount}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              открыты, но не досмотрены
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              Последний урок
            </div>
            {summary.lastWatchedVideo ? (
              <Link
                href={`/workspace/${workspaceId}/videos/${summary.lastWatchedVideo.id}`}
                className="block truncate text-base font-medium text-foreground hover:underline"
                title={summary.lastWatchedVideo.title}
              >
                {summary.lastWatchedVideo.title}
              </Link>
            ) : (
              <div className="italic text-muted-foreground">
                ещё ничего не открывал
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Прогресс по курсам</h2>
        {courses.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            В клубе пока нет курсов.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {courses.map((c) => {
              const pct =
                c.totalVideos > 0
                  ? Math.round((c.completedCount / c.totalVideos) * 100)
                  : 0
              return (
                <li key={c.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/workspace/${workspaceId}/content/courses/${c.id}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {c.title}
                    </Link>
                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
                      <span className="font-medium text-foreground">
                        {c.completedCount}/{c.totalVideos}
                      </span>
                      <span>{pct}%</span>
                      {c.inProgressCount > 0 && (
                        <span>{c.inProgressCount} в процессе</span>
                      )}
                    </div>
                  </div>
                  {c.totalVideos > 0 && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-[width]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">История просмотров (20 последних)</h2>
        {recentActivity.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Активности ещё нет.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {recentActivity.map((row) => (
              <li
                key={`${row.videoId}-${row.watchedAt}`}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <Link
                  href={`/workspace/${workspaceId}/videos/${row.videoId}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                  title={row.videoTitle}
                >
                  {row.videoTitle}
                </Link>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  {row.status === "watched" ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      Просмотрено
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                      На {formatPosition(row.position)}
                    </span>
                  )}
                  <span>{formatRelativeDays(row.watchedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
