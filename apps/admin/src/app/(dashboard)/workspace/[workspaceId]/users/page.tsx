"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  Button,
  DatePicker,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import {
  addWorkspaceMember,
  listPendingUsers,
  listWorkspaceMembers,
  rejectPendingMember,
  removeWorkspaceMember,
  updateMemberAccess,
  type MemberAccessFilter,
  type MemberSort,
  type PendingUser,
  type WorkspaceMember,
} from "../../../../../shared/api/members"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { isWorkspaceAdmin } from "../../../../../shared/lib/permissions"
import { memberStatusLabel } from "../../../../../shared/lib/member-status"
import { formatRoleName } from "../../../../../shared/lib/role-labels"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { useMyMembership } from "../../../../../shared/lib/use-my-membership"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"
import { AddDependentForm } from "../../../../../features/invite/AddDependentForm"
import { InviteMemberForm } from "../../../../../features/invite/InviteMemberForm"
import { InviteMembersCard } from "../../../../../features/invite/InviteMembersCard"
import { GuardianContacts } from "../../../../../features/users/GuardianContacts"
import { MemberProgressBlock } from "../../../../../features/users/MemberProgressBlock"
import { PendingInvitationsPanel } from "../../../../../features/users/PendingInvitationsPanel"
import { MyProfileCard } from "../../../../../features/users/MyProfileCard"

const isoToDate = (iso: string | null): Date | null => {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const MS_1D = 24 * 3600 * 1000

// Rows per «Показать ещё».
const ROSTER_PAGE = 50

// Offset pages shift when someone joins or leaves between requests: a row
// already shown is never listed twice.
const appendNew = (
  shown: WorkspaceMember[],
  next: WorkspaceMember[],
): WorkspaceMember[] => {
  const seen = new Set(shown.map((m) => m.userId))
  return [...shown, ...next.filter((m) => !seen.has(m.userId))]
}

// Compact "when did they last train" hint for the roster row. This is about
// ATTENDANCE, and it sits inches away from the abonement's class balance
// ("лимит 12: 12/12"). The old wording — "без тренировок" — read as "no classes
// left on the pass", so a member with a brand-new 12-class abonement looked
// like they had none. Say "отметок ещё не было" / "посл. визит", which can only mean
// check-ins.
const formatLastCheckIn = (iso: string | null): string => {
  if (!iso) return "отметок ещё не было"
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / MS_1D)
  if (days <= 0) return "визит сегодня"
  if (days === 1) return "визит вчера"
  return `посл. визит ${days} дн назад`
}
// Access-window segments the dashboard retention cards deep-link into
// (?filter=expiring|expired|inactive); the server applies the same
// definitions as the dashboard counters.
const ACCESS_FILTER_LABELS: Record<MemberAccessFilter, string> = {
  all: "Все",
  expiring: "Доступ истекает",
  expired: "Доступ закончился",
  inactive: "Неактивны 30д",
}
const parseAccessFilter = (value: string | null): MemberAccessFilter =>
  value === "expiring" || value === "expired" || value === "inactive"
    ? value
    : "all"

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

const SORT_LABELS: Record<MemberSort, string> = {
  expiry: "Скоро истекает",
  name: "По имени",
  newest: "Сначала новые",
  oldest: "Сначала старые",
  role: "По роли",
}

const formatName = (member: WorkspaceMember): string => {
  const parts = [member.firstname, member.lastname].filter(Boolean)
  return parts.length ? parts.join(" ") : (member.email ?? "—")
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
  const vocabulary = useVocabulary()
  const workspaceId = params?.workspaceId
  const myMembership = useMyMembership(workspaceId)
  const canManageMembers = isWorkspaceAdmin(myMembership)

  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  // Matches of the current search/segment across all pages.
  const [total, setTotal] = useState(0)
  // ROSTER_PAGE-sized pages shown so far, and whether the server has more.
  const [pagesShown, setPagesShown] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [accessDrafts, setAccessDrafts] = useState<
    Record<string, Date | null>
  >({})
  const [savingAccessId, setSavingAccessId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<MemberSort>("expiry")
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [accessFilter, setAccessFilter] = useState<MemberAccessFilter>("all")
  const [pending, setPending] = useState<PendingUser[]>([])
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null)
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null)
  const [workspaceVideoTotal, setWorkspaceVideoTotal] = useState(0)
  // Bumped after an invite/import so «Ожидают принятия» reloads.
  const [invitesKey, setInvitesKey] = useState(0)
  // A response for an older search/order/segment is dropped.
  const rosterRequest = useRef(0)

  const fetchRoster = (workspaceId: string, curPage: number, perPage: number) =>
    listWorkspaceMembers({
      workspaceId,
      q: debouncedQuery || undefined,
      sort: sortBy,
      access: accessFilter,
      curPage,
      perPage,
    })

  // (Re)loads the first `pages` pages — what is on screen — in requests of up
  // to 200 rows. `silent` keeps the table from flashing.
  const loadRoster = async (silent = false, pages = 1) => {
    if (!workspaceId) return
    const request = ++rosterRequest.current
    if (!silent) setLoading(true)
    const rows = pages * ROSTER_PAGE
    const chunk = Math.min(rows, 200)
    const chunks = Math.ceil(rows / chunk)
    try {
      const results = await Promise.all(
        Array.from({ length: chunks }, (_, i) =>
          fetchRoster(workspaceId, i + 1, chunk),
        ),
      )
      if (request !== rosterRequest.current) return
      const data = results.reduce<WorkspaceMember[]>(
        (shown, page) => appendNew(shown, page.data),
        [],
      )
      setMembers(data)
      const last = results[results.length - 1]
      setTotal(last.total)
      setPagesShown((chunks * chunk) / ROSTER_PAGE)
      setHasMore(last.data.length === chunk && chunks * chunk < last.total)
      setWorkspaceVideoTotal(results[0].workspaceVideoTotal)
      setAccessDrafts(
        Object.fromEntries(
          data.map((m) => [m.userId, isoToDate(m.accessUntil)]),
        ),
      )
    } catch (err) {
      if (request !== rosterRequest.current) return
      setError(errorMessage(err, "Не удалось загрузить участников."))
    } finally {
      if (request === rosterRequest.current) setLoading(false)
    }
  }

  const loadMore = async () => {
    if (!workspaceId) return
    const request = rosterRequest.current
    setLoadingMore(true)
    try {
      const page = await fetchRoster(workspaceId, pagesShown + 1, ROSTER_PAGE)
      if (request !== rosterRequest.current) return
      setMembers((prev) => appendNew(prev, page.data))
      setTotal(page.total)
      setPagesShown(pagesShown + 1)
      setHasMore(
        page.data.length === ROSTER_PAGE &&
          (pagesShown + 1) * ROSTER_PAGE < page.total,
      )
      // Drafts already being edited win over the fresh rows.
      setAccessDrafts((prev) => ({
        ...Object.fromEntries(
          page.data.map((m) => [m.userId, isoToDate(m.accessUntil)]),
        ),
        ...prev,
      }))
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить участников."))
    } finally {
      setLoadingMore(false)
    }
  }

  const loadPending = async () => {
    if (!workspaceId) return
    const res = await listPendingUsers({ workspaceId }).catch(() => ({
      data: [],
      total: 0,
    }))
    setPending(res.data)
  }

  // After a change: the rows already shown, then the join requests.
  const refresh = () =>
    Promise.all([loadRoster(true, Math.max(pagesShown, 1)), loadPending()])

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250)
    return () => clearTimeout(handle)
  }, [searchQuery])

  useEffect(() => {
    void loadPending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // A new search, order or segment starts over from the first page.
  useEffect(() => {
    void loadRoster()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, debouncedQuery, sortBy, accessFilter])

  // Live: members joining/leaving, role/access edits, and check-ins that change
  // a member's pack balance / access.
  useWorkspaceRealtime(workspaceId, ["members", "subscription"], () =>
    void refresh(),
  )

  const handleInvitePending = async (user: PendingUser) => {
    if (!workspaceId) return
    setInvitingUserId(user.userId)
    setError(null)
    try {
      // Approve by id: works for every pending request, including a child
      // profile a parent filed by code (no e-mail).
      await addWorkspaceMember({ workspaceId, data: { userId: user.userId } })
      await refresh()
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
    if (!window.confirm(
        `Отклонить заявку ${user.email ?? ([user.firstname, user.lastname].filter(Boolean).join(" ") || "пользователя")}?`,
      )) return
    setRejectingUserId(user.userId)
    setError(null)
    try {
      await rejectPendingMember({ workspaceId, userId: user.userId })
      await refresh()
    } catch (err) {
      setError(errorMessage(err, "Не удалось отклонить заявку."))
    } finally {
      setRejectingUserId(null)
    }
  }

  const handleRemove = async (member: WorkspaceMember) => {
    if (!workspaceId) return
    if (member.isOwner) return
    const ok = window.confirm(`Удалить ${formatName(member)} из клуба?`)
    if (!ok) return

    setRemovingId(member.userId)
    setError(null)
    try {
      await removeWorkspaceMember({ workspaceId, userId: member.userId })
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId))
      setTotal((prev) => Math.max(prev - 1, 0))
      // The rows after it moved up a place: reload what is shown so the next
      // «Показать ещё» doesn't skip one.
      void loadRoster(true, Math.max(pagesShown, 1))
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

  // A search or segment is narrowing the roster (as opposed to an empty club).
  const filtering = debouncedQuery !== "" || accessFilter !== "all"

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Участники</h1>
        <p className="text-sm text-muted-foreground">
          Пригласите участника по e-mail или раздайте ученикам код клуба.
          Нажмите на имя участника, чтобы задать имя и фамилию.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {workspaceId && (
        <InviteMembersCard
          workspaceId={workspaceId}
          canAdmin={canManageMembers}
        />
      )}

      {canManageMembers && pending.length > 0 && (
        <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Ожидают одобрения ({pending.length})
            </h2>
            <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
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
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {user.email ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fullName} · регистрация {created}
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
        <PendingInvitationsPanel
          workspaceId={workspaceId}
          refreshKey={invitesKey}
        />
      )}

      {canManageMembers && workspaceId && (
        <MyProfileCard workspaceId={workspaceId} />
      )}

      {canManageMembers && workspaceId && (
        <InviteMemberForm
          workspaceId={workspaceId}
          onInvited={() => {
            setInvitesKey((k) => k + 1)
            void refresh()
          }}
        />
      )}

      {canManageMembers && workspaceId && (
        <AddDependentForm
          workspaceId={workspaceId}
          onAdded={() => void refresh()}
        />
      )}

      {canManageMembers && workspaceId && (
        <div>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/workspace/${workspaceId}/club-import`}>
              Импорт из Excel (CSV)
            </Link>
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            Участники {total > 0 && `(${total})`}
          </h2>
          {loading && (
            <span className="text-xs text-muted-foreground">
              Обновление...
            </span>
          )}
        </div>

        {(total > 0 || filtering || searchQuery !== "") && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск по имени, e-mail, телефону или родителю"
              className="h-9 max-w-sm flex-1"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Сортировка</span>
              <Select
                value={sortBy}
                onValueChange={(value) => setSortBy(value as MemberSort)}
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
                    ] as MemberSort[]
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
                ["all", "expiring", "expired", "inactive"] as MemberAccessFilter[]
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

        {!loading && total === 0 && !filtering && (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Пока никого нет. Добавьте первого участника.
          </p>
        )}

        {!loading && total === 0 && filtering && (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {debouncedQuery
              ? `Никто не подходит под «${debouncedQuery}».`
              : `Нет участников в сегменте «${ACCESS_FILTER_LABELS[accessFilter]}».`}
          </p>
        )}

        {members.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {members.map((member) => {
              const draft = accessDrafts[member.userId] ?? null
              const dirty = draftDirtyByUser[member.userId]
              const expired =
                member.accessUntil !== null &&
                new Date(member.accessUntil) < new Date()
              return (
                // The access controls take ~480px: beside the details only
                // from xl (the list is up to 1024px there), below them before,
                // so the details are not squeezed into a one-word column.
                <li
                  key={member.userId}
                  className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr),auto] xl:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
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
                      {member.isDependent && (
                        <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-600/20">
                          Ребёнок
                        </span>
                      )}
                    </div>
                    <GuardianContacts guardians={member.guardians} />
                    {/* Each detail after the first carries its own «·», so a
                        wrapped line never ends on a dangling dot. */}
                    <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground [&>*+*]:before:mr-1.5 [&>*+*]:before:font-normal [&>*+*]:before:text-muted-foreground [&>*+*]:before:content-['·']">
                      {member.email && (
                        <span className="max-w-full truncate">{member.email}</span>
                      )}
                      <span className="whitespace-nowrap">
                        {memberStatusLabel(member.status)}
                      </span>
                      {member.roleName && (
                        <span className="whitespace-nowrap">
                          {formatRoleName(member.roleName, vocabulary)}
                        </span>
                      )}
                      {member.isOwner && (
                        <span className="whitespace-nowrap font-medium text-primary">
                          Владелец
                        </span>
                      )}
                      {!member.isOwner && (
                        <span
                          className={cn(
                            "whitespace-nowrap",
                            !member.lastCheckInAt &&
                              "text-amber-600 dark:text-amber-500",
                          )}
                        >
                          {formatLastCheckIn(member.lastCheckInAt)}
                        </span>
                      )}
                      {!member.isOwner && (
                        <span
                          className={cn(
                            "whitespace-nowrap",
                            expired
                              ? "font-medium text-destructive"
                              : member.accessUntil && "text-foreground",
                          )}
                        >
                          {formatAccessLabel(member.accessUntil)}
                        </span>
                      )}
                      {!member.isOwner &&
                        member.abonements.map((a, i) => (
                          <span
                            key={i}
                            className={cn(
                              "whitespace-nowrap",
                              a.classesRemaining !== null &&
                                a.classesRemaining <= 1 &&
                                "font-medium text-amber-600",
                            )}
                          >
                            {a.classesTotal !== null
                              ? `${a.planName}: осталось ${a.classesRemaining ?? 0} из ${a.classesTotal}`
                              : a.planName}
                          </span>
                        ))}
                    </div>
                    {!member.isOwner && workspaceVideoTotal > 0 && (
                      <MemberProgressBlock
                        member={member}
                        videoTotal={workspaceVideoTotal}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
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
                                  `Сделать доступ ${formatName(member)} бессрочным?`,
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

        {hasMore && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingMore || loading}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Загружаем..." : "Показать ещё"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
