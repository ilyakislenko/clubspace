"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import {
  Button,
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
  type MemberAccessFilter,
  type MemberSort,
  type PendingUser,
  type WorkspaceMember,
} from "../../../../../shared/api/members"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { isClubAdmin, isSportLead } from "../../../../../shared/lib/permissions"
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
// Roster segments, the same definitions as the screens that count them
// (?filter=renew|unpaid|inactive deep-links from the dashboard): «Кончается
// абонемент» = «Кому позвонить → Продлить», «Должники» = its «Ожидают оплаты».
const ACCESS_FILTER_LABELS: Record<MemberAccessFilter, string> = {
  all: "Все",
  renew: "Кончается абонемент",
  unpaid: "Должники",
  inactive: "Не были 30 дней",
}
const ACCESS_FILTERS: MemberAccessFilter[] = ["all", "renew", "unpaid", "inactive"]
const parseAccessFilter = (value: string | null): MemberAccessFilter =>
  ACCESS_FILTERS.find((f) => f === value) ?? "all"

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

const fmtDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

// One visible expiry per row: each abonement's own end; the app-access window
// only for a member without an abonement (the card shows the rest).
const accessLabel = (iso: string): string =>
  new Date(iso) < new Date()
    ? `Доступ истёк ${fmtDay(iso)}`
    : `Доступ до ${fmtDay(iso)}`

export default function WorkspaceUsersPage() {
  const params = useParams<{ workspaceId: string }>()
  const vocabulary = useVocabulary()
  const workspaceId = params?.workspaceId
  const myMembership = useMyMembership(workspaceId)
  // Roster work is the sport leads'; staff roles, import and workspace
  // settings are the club admins'.
  const canManageMembers = isSportLead(myMembership)
  const canAdmin = isClubAdmin(myMembership)

  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  // Matches of the current search/segment across all pages.
  const [total, setTotal] = useState(0)
  // ROSTER_PAGE-sized pages shown so far, and whether the server has more.
  const [pagesShown, setPagesShown] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
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
          canRotateCode={canManageMembers}
          canSetAutoApprove={canAdmin}
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
          canInviteStaff={canAdmin}
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

      {canAdmin && workspaceId && (
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
              <span className="text-xs text-muted-foreground">Показать</span>
              {ACCESS_FILTERS.map((key) => (
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
              return (
                <li key={member.userId} className="p-3">
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
                      {!member.isOwner &&
                        member.abonements.length === 0 &&
                        member.accessUntil && (
                          <span
                            className={cn(
                              "whitespace-nowrap",
                              new Date(member.accessUntil) < new Date() &&
                                "font-medium text-destructive",
                            )}
                          >
                            {accessLabel(member.accessUntil)}
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
                            {a.planName}
                            {a.classesTotal !== null &&
                              `: осталось ${a.classesRemaining ?? 0} из ${a.classesTotal}`}
                            {a.endDate && ` · до ${fmtDay(a.endDate)}`}
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
