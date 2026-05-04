"use client"

import { useParams } from "next/navigation"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import {
  Button,
  DatePicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bjj-academy/ui-kit/ui"

import {
  addWorkspaceMember,
  listPendingUsers,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateMemberAccess,
  type PendingUser,
  type WorkspaceMember,
} from "../../../../../shared/api/members"

const isoToDate = (iso: string | null): Date | null => {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const dateToEndOfDayIso = (date: Date | null): string | null => {
  if (!date) return null
  // Treat the date as end-of-day local time so "до 1 июня" means 1 июня is still inside the access window.
  const local = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  )
  return local.toISOString()
}

const sameDay = (a: Date | null, b: Date | null): boolean => {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

type SortKey = "expiry" | "name" | "newest" | "oldest" | "role"

const SORT_LABELS: Record<SortKey, string> = {
  expiry: "Скоро истекает",
  name: "По имени",
  newest: "Сначала новые",
  oldest: "Сначала старые",
  role: "По роли",
}

const memberDisplayName = (member: WorkspaceMember) => {
  const parts = [member.firstname, member.lastname].filter(Boolean)
  return (parts.length ? parts.join(" ") : member.email).toLowerCase()
}

const compareMembers = (
  a: WorkspaceMember,
  b: WorkspaceMember,
  sortBy: SortKey,
): number => {
  // Owner всегда сверху, чтобы admin его видел независимо от сортировки.
  if (a.isOwner && !b.isOwner) return -1
  if (!a.isOwner && b.isOwner) return 1

  switch (sortBy) {
    case "expiry": {
      // null (без ограничения) — в самый низ; затем по дате истечения от ближайшего к дальнему.
      if (a.accessUntil === null && b.accessUntil === null) return 0
      if (a.accessUntil === null) return 1
      if (b.accessUntil === null) return -1
      return (
        new Date(a.accessUntil).getTime() - new Date(b.accessUntil).getTime()
      )
    }
    case "name":
      return memberDisplayName(a).localeCompare(memberDisplayName(b), "ru")
    case "newest":
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    case "oldest":
      return (
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    case "role":
      return (a.roleName ?? "").localeCompare(b.roleName ?? "", "ru")
    default:
      return 0
  }
}

const formatAccessLabel = (iso: string | null): string => {
  if (!iso) return "Без ограничения"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const formatted = date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  return date < new Date()
    ? `Истёк ${formatted}`
    : `Доступ до ${formatted}`
}

export default function WorkspaceUsersPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [accessDrafts, setAccessDrafts] = useState<
    Record<string, Date | null>
  >({})
  const [savingAccessId, setSavingAccessId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>("expiry")
  const [searchQuery, setSearchQuery] = useState("")
  const [pending, setPending] = useState<PendingUser[]>([])
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null)
  const [workspaceVideoTotal, setWorkspaceVideoTotal] = useState(0)

  const loadMembers = async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const [members, pending] = await Promise.all([
        listWorkspaceMembers({ workspaceId }),
        listPendingUsers({ workspaceId }).catch(() => ({
          data: [],
          total: 0,
        })),
      ])
      setMembers(members.data)
      setWorkspaceVideoTotal(members.workspaceVideoTotal)
      setPending(pending.data)
      setAccessDrafts(
        Object.fromEntries(
          members.data.map((m) => [m.userId, isoToDate(m.accessUntil)]),
        ),
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить участников.",
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const handleInvitePending = async (user: PendingUser) => {
    if (!workspaceId) return
    setInvitingUserId(user.userId)
    setError(null)
    try {
      await addWorkspaceMember({ workspaceId, email: user.email })
      await loadMembers()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось пригласить.",
      )
    } finally {
      setInvitingUserId(null)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!workspaceId || !email.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      await addWorkspaceMember({ workspaceId, email: email.trim() })
      setEmail("")
      await loadMembers()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось добавить участника.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemove = async (member: WorkspaceMember) => {
    if (!workspaceId) return
    if (member.isOwner) return
    const ok = window.confirm(`Удалить ${member.email} из клуба?`)
    if (!ok) return

    setRemovingId(member.userId)
    setError(null)
    try {
      await removeWorkspaceMember({ workspaceId, userId: member.userId })
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось удалить участника.",
      )
    } finally {
      setRemovingId(null)
    }
  }

  const handleAccessSave = async (
    member: WorkspaceMember,
    nextDate: Date | null,
  ) => {
    if (!workspaceId) return
    const nextIso = dateToEndOfDayIso(nextDate)
    setSavingAccessId(member.userId)
    setError(null)
    try {
      const response = await updateMemberAccess({
        workspaceId,
        userId: member.userId,
        accessUntil: nextIso,
      })
      setMembers((prev) =>
        prev.map((m) =>
          m.userId === member.userId
            ? { ...m, accessUntil: response.accessUntil }
            : m,
        ),
      )
      setAccessDrafts((prev) => ({
        ...prev,
        [member.userId]: isoToDate(response.accessUntil),
      }))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось сохранить доступ.",
      )
    } finally {
      setSavingAccessId(null)
    }
  }

  const formatName = (member: WorkspaceMember) => {
    const parts = [member.firstname, member.lastname].filter(Boolean)
    return parts.length ? parts.join(" ") : member.email
  }

  const draftDirtyByUser = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const member of members) {
      const draft = accessDrafts[member.userId] ?? null
      const original = isoToDate(member.accessUntil)
      map[member.userId] = !sameDay(draft, original)
    }
    return map
  }, [accessDrafts, members])

  const visibleMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const filtered = query
      ? members.filter((member) => {
          const name = memberDisplayName(member)
          return (
            member.email.toLowerCase().includes(query) ||
            name.includes(query) ||
            member.roleName.toLowerCase().includes(query)
          )
        })
      : members
    return [...filtered].sort((a, b) => compareMembers(a, b, sortBy))
  }, [members, searchQuery, sortBy])

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Участники клуба</h1>
        <p className="text-sm text-muted-foreground">
          Добавьте участника по email — он сможет войти в клиент через код,
          отправленный на эту почту.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-border bg-card p-4"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr,auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="member-email">Email участника</Label>
            <Input
              id="member-email"
              type="email"
              placeholder="member@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={submitting}
            />
          </div>
          <Button type="submit" disabled={submitting || !email.trim()}>
            {submitting ? "Добавляем..." : "Добавить"}
          </Button>
        </div>
      </form>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {pending.length > 0 && (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/40 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-amber-900">
              Ожидают одобрения ({pending.length})
            </h2>
            <p className="text-xs text-amber-800/80">
              Эти пользователи зарегистрировались в мобильном приложении и
              ждут вашего подтверждения. Нажмите «Принять» — они появятся в
              списке участников и получат доступ к курсам.
            </p>
          </div>
          <ul className="space-y-2">
            {pending.map((user) => {
              const fullName =
                [user.firstname, user.lastname].filter(Boolean).join(" ") ||
                "—"
              const created = new Date(user.createdAt).toLocaleDateString(
                "ru-RU",
                {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                },
              )
              return (
                <li
                  key={user.userId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {fullName} · зарегистрировался {created}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleInvitePending(user)}
                    disabled={invitingUserId === user.userId}
                  >
                    {invitingUserId === user.userId
                      ? "Принимаем..."
                      : "Принять"}
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            Участники {members.length > 0 && `(${members.length})`}
          </h2>
          {loading && (
            <span className="text-xs text-muted-foreground">
              Обновление...
            </span>
          )}
        </div>

        {members.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск по email, имени или роли"
              className="h-9 max-w-sm flex-1"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Сортировка</span>
              <Select
                value={sortBy}
                onValueChange={(value) => setSortBy(value as SortKey)}
              >
                <SelectTrigger className="h-9 w-[200px]">
                  <SelectValue>{SORT_LABELS[sortBy]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      "expiry",
                      "name",
                      "newest",
                      "oldest",
                      "role",
                    ] as SortKey[]
                  ).map((key) => (
                    <SelectItem key={key} value={key}>
                      {SORT_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {!loading && members.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Пока никого нет. Добавьте первого участника.
          </p>
        )}

        {!loading && members.length > 0 && visibleMembers.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Никто не подходит под «{searchQuery}».
          </p>
        )}

        {visibleMembers.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {visibleMembers.map((member) => {
              const draft = accessDrafts[member.userId] ?? null
              const dirty = draftDirtyByUser[member.userId]
              const expired =
                member.accessUntil !== null &&
                new Date(member.accessUntil) < new Date()
              return (
                <li
                  key={member.userId}
                  className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr),auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {formatName(member)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{member.email}</span>
                      <span>·</span>
                      <span className="uppercase">{member.status}</span>
                      {member.roleName && (
                        <>
                          <span>·</span>
                          <span className="capitalize">
                            {member.roleName}
                          </span>
                        </>
                      )}
                      {member.isOwner && (
                        <>
                          <span>·</span>
                          <span className="font-medium text-primary">
                            Владелец
                          </span>
                        </>
                      )}
                      {!member.isOwner && (
                        <>
                          <span>·</span>
                          <span
                            className={
                              expired
                                ? "font-medium text-destructive"
                                : member.accessUntil
                                  ? "text-foreground"
                                  : ""
                            }
                          >
                            {formatAccessLabel(member.accessUntil)}
                          </span>
                        </>
                      )}
                    </div>
                    {!member.isOwner && workspaceVideoTotal > 0 && (
                      <MemberProgressBlock
                        workspaceId={workspaceId}
                        member={member}
                        videoTotal={workspaceVideoTotal}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {!member.isOwner && (
                      <>
                        <DatePicker
                          value={draft}
                          onChange={(date) =>
                            setAccessDrafts((prev) => ({
                              ...prev,
                              [member.userId]: date,
                            }))
                          }
                          disabled={savingAccessId === member.userId}
                          placeholder="Без ограничения"
                          className="h-8 w-[200px]"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={
                            !dirty || savingAccessId === member.userId
                          }
                          onClick={() => void handleAccessSave(member, draft)}
                        >
                          {savingAccessId === member.userId
                            ? "Сохраняем..."
                            : "Сохранить"}
                        </Button>
                        {member.accessUntil && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={savingAccessId === member.userId}
                            onClick={() => void handleAccessSave(member, null)}
                          >
                            Снять
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => void handleRemove(member)}
                          disabled={removingId === member.userId}
                        >
                          {removingId === member.userId
                            ? "Удаляем..."
                            : "Удалить"}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

type ActivityLevel = "active" | "slowing" | "inactive" | "never"

const computeActivity = (lastWatchedAt: string | null): ActivityLevel => {
  if (!lastWatchedAt) return "never"
  const ms = Date.now() - new Date(lastWatchedAt).getTime()
  const days = ms / (24 * 3600 * 1000)
  if (days <= 7) return "active"
  if (days <= 21) return "slowing"
  return "inactive"
}

const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  active: "Активен",
  slowing: "Замедляется",
  inactive: "Простаивает",
  never: "Не начинал",
}

const ACTIVITY_CHIP: Record<ActivityLevel, string> = {
  active:
    "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  slowing: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  inactive: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
  never:
    "bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-600/20 italic",
}

const formatRelativeDays = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / (24 * 3600 * 1000))
  if (days <= 0) return "сегодня"
  if (days === 1) return "вчера"
  if (days < 7) return `${days} дн назад`
  if (days < 30) return `${Math.floor(days / 7)} нед назад`
  if (days < 365) return `${Math.floor(days / 30)} мес назад`
  return `${Math.floor(days / 365)} г назад`
}

function MemberProgressBlock({
  workspaceId,
  member,
  videoTotal,
}: {
  workspaceId?: string
  member: WorkspaceMember
  videoTotal: number
}) {
  const activity = computeActivity(member.lastWatchedAt)
  const completedPct =
    videoTotal > 0
      ? Math.min(100, Math.round((member.watchedCount / videoTotal) * 100))
      : 0
  const inProgress = member.inProgressCount

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTIVITY_CHIP[activity]}`}
        >
          {ACTIVITY_LABEL[activity]}
        </span>
        <span className="font-medium text-foreground tabular-nums">
          {member.watchedCount}/{videoTotal} видео
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="tabular-nums text-muted-foreground">
          {completedPct}%
        </span>
        {inProgress > 0 && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {inProgress} в процессе
            </span>
          </>
        )}
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width]"
          style={{ width: `${completedPct}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {member.lastWatchedAt && member.lastWatchedVideo ? (
          <span className="truncate">
            Последнее:{" "}
            {workspaceId ? (
              <a
                href={`/workspace/${workspaceId}/videos/${member.lastWatchedVideo.id}`}
                className="text-foreground hover:underline"
              >
                {member.lastWatchedVideo.title}
              </a>
            ) : (
              <span className="text-foreground">
                {member.lastWatchedVideo.title}
              </span>
            )}{" "}
            · {formatRelativeDays(member.lastWatchedAt)}
          </span>
        ) : (
          <span className="italic">не открывал ещё ничего</span>
        )}
      </div>
    </div>
  )
}
