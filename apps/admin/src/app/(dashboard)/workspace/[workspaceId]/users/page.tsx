"use client"

import Link from "next/link"
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
} from "@clubspace/ui-kit/ui"

import {
  addWorkspaceMember,
  listPendingUsers,
  listWorkspaceMembers,
  rejectPendingMember,
  removeWorkspaceMember,
  updateMemberAccess,
  type PendingUser,
  type WorkspaceMember,
} from "../../../../../shared/api/members"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { isWorkspaceAdmin } from "../../../../../shared/lib/permissions"
import { memberStatusLabel } from "../../../../../shared/lib/member-status"
import { formatRoleName } from "../../../../../shared/lib/role-labels"
import { useMyMembership } from "../../../../../shared/lib/use-my-membership"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"
import { MemberProgressBlock } from "../../../../../features/users/MemberProgressBlock"
import { ImportMembersPanel } from "../../../../../features/users/ImportMembersPanel"
import { MyProfileCard } from "../../../../../features/users/MyProfileCard"

const isoToDate = (iso: string | null): Date | null => {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

// Access-window segments the dashboard retention cards deep-link into
// (?filter=expiring|expired). Mirrors the server's expiringSoon/expiredAccess
// definitions (14-day horizon).
const MS_1D = 24 * 3600 * 1000
const MS_14D = 14 * MS_1D
const MS_30D = 30 * MS_1D

// Compact "when did they last train" hint for the roster row. This is about
// ATTENDANCE, and it sits inches away from the abonement's class balance
// ("лимит 12: 12/12"). The old wording — "без тренировок" — read as "no classes
// left on the pass", so a member with a brand-new 12-class abonement looked
// like they had none. Say "не отмечался" / "посл. визит", which can only mean
// check-ins.
const formatLastCheckIn = (iso: string | null): string => {
  if (!iso) return "ни разу не отмечался"
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / MS_1D)
  if (days <= 0) return "был сегодня"
  if (days === 1) return "был вчера"
  return `посл. визит ${days} дн назад`
}
type AccessFilter = "all" | "expiring" | "expired" | "inactive"
const ACCESS_FILTER_LABELS: Record<AccessFilter, string> = {
  all: "Все",
  expiring: "Доступ истекает",
  expired: "Доступ закончился",
  inactive: "Неактивны 30д",
}
const parseAccessFilter = (value: string | null): AccessFilter =>
  value === "expiring" || value === "expired" || value === "inactive"
    ? value
    : "all"

const matchesAccessFilter = (
  member: {
    isOwner: boolean
    status: string
    accessUntil: string | null
    lastCheckInAt: string | null
  },
  filter: AccessFilter,
): boolean => {
  if (filter === "all") return true
  // Owners aren't a churn/renewal risk and have no access window.
  if (member.isOwner) return false
  if (filter === "inactive") {
    // Active members with no check-in in the last 30 days (incl. never) —
    // matches the dashboard's inactiveMembers30d.
    if (member.status !== "ACTIVE") return false
    if (!member.lastCheckInAt) return true
    return new Date(member.lastCheckInAt).getTime() < Date.now() - MS_30D
  }
  if (!member.accessUntil) return false
  const until = new Date(member.accessUntil).getTime()
  const now = Date.now()
  if (filter === "expired") return until < now
  return until >= now && until < now + MS_14D
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
  const myMembership = useMyMembership(workspaceId)
  const canManageMembers = isWorkspaceAdmin(myMembership)

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
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all")
  const [pending, setPending] = useState<PendingUser[]>([])
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null)
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null)
  const [workspaceVideoTotal, setWorkspaceVideoTotal] = useState(0)

  const loadMembers = async (silent = false) => {
    if (!workspaceId) return
    if (!silent) setLoading(true)
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
        errorMessage(err, "Не удалось загрузить участников."),
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // Live: members joining/leaving, role/access edits, and check-ins that change
  // a member's pack balance / access. Silent so the table doesn't flash.
  useWorkspaceRealtime(workspaceId, ["members", "subscription"], () =>
    void loadMembers(true),
  )

  const handleInvitePending = async (user: PendingUser) => {
    if (!workspaceId) return
    setInvitingUserId(user.userId)
    setError(null)
    try {
      await addWorkspaceMember({ workspaceId, email: user.email })
      await loadMembers()
    } catch (err) {
      setError(
        errorMessage(err, "Не удалось пригласить."),
      )
    } finally {
      setInvitingUserId(null)
    }
  }

  const handleRejectPending = async (user: PendingUser) => {
    if (!workspaceId) return
    if (!window.confirm(`Отклонить заявку ${user.email}?`)) return
    setRejectingUserId(user.userId)
    setError(null)
    try {
      await rejectPendingMember({ workspaceId, userId: user.userId })
      await loadMembers()
    } catch (err) {
      setError(errorMessage(err, "Не удалось отклонить заявку."))
    } finally {
      setRejectingUserId(null)
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
        errorMessage(err, "Не удалось добавить участника."),
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
        errorMessage(err, "Не удалось удалить участника."),
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
        errorMessage(err, "Не удалось сохранить доступ."),
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

  // Adopt a ?filter= deep-link from the dashboard retention cards once, on
  // mount. Read from window (not useSearchParams) to avoid a Suspense boundary.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("filter")
    const parsed = parseAccessFilter(param)
    if (parsed !== "all") setAccessFilter(parsed)
  }, [])

  const visibleMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const filtered = members.filter((member) => {
      if (!matchesAccessFilter(member, accessFilter)) return false
      if (!query) return true
      const name = memberDisplayName(member)
      return (
        member.email.toLowerCase().includes(query) ||
        name.includes(query) ||
        member.roleName.toLowerCase().includes(query) ||
        formatRoleName(member.roleName).toLowerCase().includes(query)
      )
    })
    return [...filtered].sort((a, b) => compareMembers(a, b, sortBy))
  }, [members, searchQuery, sortBy, accessFilter])

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Участники</h1>
        <p className="text-sm text-muted-foreground">
          Добавьте участника по email — он сможет войти в приложение клуба
          по коду из письма, отправленного на эту почту. Нажмите на имя участника в списке, чтобы
          задать ему имя и фамилию.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {canManageMembers && pending.length > 0 && (
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
                    onClick={() => void handleInvitePending(user)}
                    disabled={
                      invitingUserId === user.userId ||
                      rejectingUserId === user.userId
                    }
                  >
                    {invitingUserId === user.userId
                      ? "Принимаем..."
                      : "Принять"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleRejectPending(user)}
                    disabled={
                      invitingUserId === user.userId ||
                      rejectingUserId === user.userId
                    }
                  >
                    {rejectingUserId === user.userId
                      ? "Отклоняем..."
                      : "Отклонить"}
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {canManageMembers && workspaceId && (
        <MyProfileCard workspaceId={workspaceId} />
      )}

      {canManageMembers && (
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
      )}

      {canManageMembers && workspaceId && (
        <ImportMembersPanel
          workspaceId={workspaceId}
          onImported={() => void loadMembers()}
        />
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
            <div className="flex w-full flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Доступ</span>
              {(
                ["all", "expiring", "expired", "inactive"] as AccessFilter[]
              ).map((key) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={accessFilter === key ? "secondary" : "ghost"}
                  className="h-8"
                  onClick={() => setAccessFilter(key)}
                >
                  {ACCESS_FILTER_LABELS[key]}
                </Button>
              ))}
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
            {searchQuery
              ? `Никто не подходит под «${searchQuery}».`
              : `Нет участников в сегменте «${ACCESS_FILTER_LABELS[accessFilter]}».`}
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
                    {workspaceId && !member.isOwner ? (
                      <Link
                        href={`/workspace/${workspaceId}/users/${member.userId}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {formatName(member)}
                      </Link>
                    ) : (
                      <div className="truncate text-sm font-medium">
                        {formatName(member)}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{member.email}</span>
                      <span>·</span>
                      <span>{memberStatusLabel(member.status)}</span>
                      {member.roleName && (
                        <>
                          <span>·</span>
                          <span>{formatRoleName(member.roleName)}</span>
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
                              member.lastCheckInAt ? "" : "text-amber-600 dark:text-amber-500"
                            }
                          >
                            {formatLastCheckIn(member.lastCheckInAt)}
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
                      {!member.isOwner && member.subscription && (
                        <>
                          <span>·</span>
                          <span
                            className={
                              member.subscription.classesRemaining !== null &&
                              member.subscription.classesRemaining <= 1
                                ? "font-medium text-amber-600"
                                : ""
                            }
                          >
                            {member.subscription.classesTotal !== null
                              ? `${member.subscription.planName}: осталось ${member.subscription.classesRemaining ?? 0} из ${member.subscription.classesTotal}`
                              : member.subscription.planName}
                          </span>
                        </>
                      )}
                    </div>
                    {!member.isOwner && workspaceVideoTotal > 0 && (
                      <MemberProgressBlock
                        member={member}
                        videoTotal={workspaceVideoTotal}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {!member.isOwner && canManageMembers && (
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
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Сделать доступ ${member.email} бессрочным?`,
                                )
                              )
                                void handleAccessSave(member, null)
                            }}
                          >
                            Бессрочно
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
