"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { MemberSubscriptionPanel } from "../../../../../../features/subscriptions/MemberSubscriptionPanel"
import { MemberRankPanel } from "../../../../../../features/ranks/MemberRankPanel"

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import {
  listRoles,
  updateMemberRole,
  type Role,
} from "../../../../../../shared/api/groups"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import {
  getMemberProgress,
  updateMemberProfile,
  type MemberProgress,
} from "../../../../../../shared/api/members"
import {
  ACTIVITY_CHIP,
  ACTIVITY_LABEL,
  computeActivity,
  formatRelativeDays,
} from "../../../../../../shared/lib/member-activity"
import { isWorkspaceAdmin } from "../../../../../../shared/lib/permissions"
import { formatRoleName } from "../../../../../../shared/lib/role-labels"
import { useMyMembership } from "../../../../../../shared/lib/use-my-membership"
import { ProfileEditForm } from "../../../../../../features/users/ProfileEditForm"
import { MemberNotesPanel } from "../../../../../../features/users/MemberNotesPanel"
import { MemberAttendancePanel } from "../../../../../../features/users/MemberAttendancePanel"

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
  const myMembership = useMyMembership(workspaceId)
  const canManageProfile = isWorkspaceAdmin(myMembership)

  const [data, setData] = useState<MemberProgress | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [savingRole, setSavingRole] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => {
    if (!workspaceId || !userId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    void (async () => {
      try {
        const [progress, rolesResp] = await Promise.all([
          getMemberProgress({ workspaceId, userId }),
          listRoles({ workspaceId }).catch(() => ({ data: [] as Role[] })),
        ])
        if (cancelled) return
        setData(progress)
        setRoles(rolesResp.data)
      } catch (err) {
        if (cancelled) return
        setLoadError(
          errorMessage(err, "Не удалось загрузить профиль ученика."),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceId, userId])

  // Silent re-read (no skeleton) so the header's access status follows an
  // assignment made in the subscription panel without remounting the panels.
  const refreshMember = async () => {
    if (!workspaceId || !userId) return
    try {
      const progress = await getMemberProgress({ workspaceId, userId })
      setData(progress)
    } catch (err) {
      setActionError(errorMessage(err, "Не удалось обновить профиль"))
    }
  }

  const handleProfileSave = async (patch: {
    firstname: string | null
    lastname: string | null
    email: string
  }) => {
    if (!workspaceId || !userId) return
    setSavingProfile(true)
    setActionError(null)
    try {
      const result = await updateMemberProfile({
        workspaceId,
        userId,
        firstname: patch.firstname,
        lastname: patch.lastname,
        email: patch.email,
      })
      setData((prev) =>
        prev
          ? {
              ...prev,
              member: {
                ...prev.member,
                firstname: result.firstname,
                lastname: result.lastname,
                email: result.email,
              },
            }
          : prev,
      )
      setEditingProfile(false)
    } catch (err) {
      setActionError(
        errorMessage(err, "Не удалось сохранить профиль"),
      )
    } finally {
      setSavingProfile(false)
    }
  }

  const handleRoleChange = async (newRoleId: string) => {
    if (!workspaceId || !userId || !data) return
    if (newRoleId === data.member.roleId) return
    const newRole = roles.find((r) => r.id === newRoleId)
    if (
      !window.confirm(
        `Назначить роль «${formatRoleName(newRole?.name ?? "")}»? Это изменит доступ участника к админке.`,
      )
    )
      return
    setSavingRole(true)
    setActionError(null)
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
      setActionError(
        errorMessage(err, "Не удалось обновить роль"),
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

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link
          href={`/workspace/${workspaceId}/users`}
          className="text-sm text-primary hover:underline"
        >
          ← Все ученики
        </Link>
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadError}
        </p>
      </div>
    )
  }

  if (!data) return null

  const { member, summary, groups, courses, recentActivity, attendance } = data
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
          <span>{formatRoleName(member.roleName)}</span>
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

      {!member.isOwner && canManageProfile && workspaceId && userId && (
        <MemberSubscriptionPanel
          workspaceId={workspaceId}
          userId={userId}
          onAssigned={() => void refreshMember()}
        />
      )}

      {canManageProfile && workspaceId && userId && (
        <MemberRankPanel workspaceId={workspaceId} userId={userId} />
      )}

      {!member.isOwner && canManageProfile && workspaceId && userId && (
        <MemberAttendancePanel workspaceId={workspaceId} userId={userId} />
      )}

      {canManageProfile && workspaceId && userId && (
        <MemberNotesPanel
          workspaceId={workspaceId}
          userId={userId}
          initialNotes={member.notes}
        />
      )}

      {actionError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {!member.isOwner && canManageProfile && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Профиль</div>
            {!editingProfile && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setEditingProfile(true)}
              >
                Изменить
              </Button>
            )}
          </div>
          {editingProfile ? (
            <ProfileEditForm
              initial={{
                firstname: member.firstname ?? "",
                lastname: member.lastname ?? "",
                email: member.email,
              }}
              submitting={savingProfile}
              onCancel={() => setEditingProfile(false)}
              onSubmit={handleProfileSave}
            />
          ) : (
            <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
              <dt className="text-muted-foreground">Имя</dt>
              <dd>
                {member.firstname || (
                  <span className="italic text-muted-foreground">
                    не задано
                  </span>
                )}
              </dd>
              <dt className="text-muted-foreground">Фамилия</dt>
              <dd>
                {member.lastname || (
                  <span className="italic text-muted-foreground">
                    не задано
                  </span>
                )}
              </dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{member.email}</dd>
            </dl>
          )}
        </div>
      )}

      {!member.isOwner && canManageProfile && roles.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
          <div className="text-sm">
            <div className="font-medium">Роль в клубе</div>
            <div className="text-xs text-muted-foreground">
              Определяет доступ к админке: ученик — только мобильное
              приложение, тренер — свои группы, главный тренер и
              администратор — всё.
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
                    {formatRoleName(r.name)}
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
                title={`${g.gym?.name ?? "Без зала"}${g.role === "coach" ? " · ведёт" : ""}`}
              >
                <span className="font-medium">{g.name}</span>
                <span className="text-[11px] opacity-70">·</span>
                <span className="text-[11px]">
                  {g.gym?.name ?? "без зала"}
                </span>
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
        <h2 className="text-sm font-medium">
          Посещаемость{" "}
          <span className="text-muted-foreground">· {attendance.count}</span>
        </h2>
        {attendance.recent.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Пока нет отметок о посещении.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {attendance.recent.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <span className="min-w-0 truncate">{s.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  {new Date(s.startAt).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: s.timezone,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

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
