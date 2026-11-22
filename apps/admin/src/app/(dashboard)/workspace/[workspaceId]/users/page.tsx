"use client"

import { MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import {
  GUARDIAN_LINE_PREFIX,
  guardianName,
} from "../../../../../shared/lib/guardians"
import { isClubAdmin, isSportLead } from "../../../../../shared/lib/permissions"
import { memberStatusLabel } from "../../../../../shared/lib/member-status"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import { formatRoleName } from "../../../../../shared/lib/role-labels"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { useMyMembership } from "../../../../../shared/lib/use-my-membership"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"
import { confirmDialog } from "../../../../../shared/ui/confirm-dialog"
import { InviteSheet } from "../../../../../features/invite/InviteSheet"

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

// Roster segments, the same definitions as the screens that count them
// (?filter=renew|unpaid|inactive deep-links from the dashboard): «Кончается
// абонемент» = «Удержание → Продлить», «Должники» = its «Ожидают оплаты».
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
  // Oldest end of the access window first (long-lapsed members lead).
  expiry: "По дате окончания доступа",
  name: "По имени",
  newest: "Сначала новые",
  oldest: "Сначала старые",
  role: "По роли",
}
const SORTS: MemberSort[] = ["name", "expiry", "newest", "oldest", "role"]

const formatName = (member: WorkspaceMember): string => {
  const parts = [member.firstname, member.lastname].filter(Boolean)
  return parts.length ? parts.join(" ") : (member.email ?? "—")
}

const pendingName = (user: PendingUser): string =>
  [user.firstname, user.lastname].filter(Boolean).join(" ") ||
  user.email ||
  "Без имени"

// «12 декабря», with the year only when it is not this year's.
const fmtDay = (iso: string): string => {
  const date = new Date(iso)
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" }
      : {}),
  })
}

// The second line of a roster row: what the member holds — each abonement
// with its balance and end; the app-access window only for a member without an
// abonement (one visible expiry per row; the card shows the rest).
function MemberHolding({ member }: { member: WorkspaceMember }) {
  if (member.abonements.length > 0) {
    return (
      <>
        {member.abonements.map((a, i) => (
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
              `, осталось ${a.classesRemaining ?? 0} из ${a.classesTotal}`}
            {a.endDate && `, до ${fmtDay(a.endDate)}`}
          </span>
        ))}
      </>
    )
  }
  if (!member.accessUntil) return null
  const expired = new Date(member.accessUntil) < new Date()
  return (
    <span
      className={cn("whitespace-nowrap", expired && "font-medium text-destructive")}
    >
      {expired ? "Доступ истёк" : "Доступ до"} {fmtDay(member.accessUntil)}
    </span>
  )
}

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
  const [sortBy, setSortBy] = useState<MemberSort>("name")
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [accessFilter, setAccessFilter] = useState<MemberAccessFilter>("all")
  const [pending, setPending] = useState<PendingUser[]>([])
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null)
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
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

  const handleApprovePending = async (user: PendingUser) => {
    if (!workspaceId) return
    setInvitingUserId(user.userId)
    setError(null)
    try {
      // Approve by id: works for every pending request, including a child
      // profile a parent filed by code (no e-mail).
      await addWorkspaceMember({ workspaceId, data: { userId: user.userId } })
      await refresh()
    } catch (err) {
      setError(errorMessage(err, "Не удалось принять заявку."))
    } finally {
      setInvitingUserId(null)
    }
  }

  const handleRejectPending = async (user: PendingUser) => {
    if (!workspaceId) return
    const ok = await confirmDialog({
      title: `Отклонить заявку: ${pendingName(user)}?`,
      description:
        "Человек не попадёт в клуб и не сможет подать заявку снова по коду клуба.",
      confirmLabel: "Отклонить",
      destructive: true,
    })
    if (!ok) return
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

  // Adopt deep-links once, on mount: ?filter= from the dashboard retention
  // cards, ?invite=1 from the launch checklist. Read from window (not
  // useSearchParams) to avoid a Suspense boundary.
  useEffect(() => {
    const url = new URL(window.location.href)
    const parsed = parseAccessFilter(url.searchParams.get("filter"))
    if (parsed !== "all") setAccessFilter(parsed)
    if (url.searchParams.has("invite")) {
      url.searchParams.delete("invite")
      window.history.replaceState(window.history.state, "", url)
      setInviteOpen(true)
    }
  }, [])

  // A search or segment is narrowing the roster (as opposed to an empty club).
  const filtering = debouncedQuery !== "" || accessFilter !== "all"

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Ученики</h1>
        {workspaceId && (
          <div className="flex items-center gap-1">
            <Button type="button" onClick={() => setInviteOpen(true)}>
              Пригласить
            </Button>
            {canAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Ещё">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={`/workspace/${workspaceId}/club-import`}>
                      Импорт из Excel (CSV)
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {canManageMembers && pending.length > 0 && (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/5">
          <h2 className="px-3 pt-2.5 text-sm font-medium">
            Заявки на вступление · {pending.length}
          </h2>
          <ul className="divide-y divide-amber-500/20">
            {pending.map((user) => {
              const busy =
                invitingUserId === user.userId || rejectingUserId === user.userId
              const name = pendingName(user)
              return (
                <li
                  key={user.userId}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email && user.email !== name && `${user.email} · `}
                      заявка от {fmtDay(user.createdAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleApprovePending(user)}
                    disabled={busy}
                  >
                    {invitingUserId === user.userId ? "Принимаем…" : "Принять"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleRejectPending(user)}
                    disabled={busy}
                  >
                    {rejectingUserId === user.userId ? "Отклоняем…" : "Отклонить"}
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {(total > 0 || filtering || searchQuery !== "") && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск по имени, e-mail, телефону или родителю"
              aria-label="Поиск"
              className="h-9 max-w-sm flex-1"
            />
            <Select
              value={sortBy}
              onValueChange={(value) => setSortBy(value as MemberSort)}
            >
              <SelectTrigger className="h-9 w-[240px]" aria-label="Сортировка">
                <SelectValue>{SORT_LABELS[sortBy]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-auto text-xs text-muted-foreground">
              {loading
                ? "Обновление…"
                : `${total} ${pluralRu(total, "человек", "человека", "человек")}`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {ACCESS_FILTERS.map((key) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={accessFilter === key ? "secondary" : "ghost"}
                className="h-8"
                aria-pressed={accessFilter === key}
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
          Пока никого нет. Нажмите «Пригласить», чтобы раздать код клуба или
          пригласить по e-mail.
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
            // Students are the default: a role shows only for staff.
            const role = member.isOwner
              ? "Владелец"
              : member.roleName !== "user"
                ? formatRoleName(member.roleName, vocabulary)
                : null
            const content = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {formatName(member)}
                    </span>
                    {member.isDependent && (
                      <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-600/20">
                        Ребёнок
                      </span>
                    )}
                  </div>
                  {member.guardians.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">
                      {member.guardians
                        .map(
                          (g) =>
                            `${GUARDIAN_LINE_PREFIX[g.relation]}: ${guardianName(g) || g.email || "—"}`,
                        )
                        .join(" · ")}
                    </p>
                  )}
                  {/* Each detail after the first carries its own «·», so a
                      wrapped line never ends on a dangling dot. */}
                  <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground empty:hidden [&>*+*]:before:mr-1.5 [&>*+*]:before:content-['·']">
                    {role && <span className="whitespace-nowrap">{role}</span>}
                    {member.status !== "ACTIVE" && (
                      <span className="whitespace-nowrap font-medium text-destructive">
                        {memberStatusLabel(member.status)}
                      </span>
                    )}
                    {!member.isOwner && <MemberHolding member={member} />}
                  </div>
                </div>
                {member.owesPayment && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-destructive">
                    <span
                      aria-hidden
                      className="size-2 rounded-full bg-destructive"
                    />
                    Долг
                  </span>
                )}
              </>
            )
            return (
              <li key={member.userId}>
                {workspaceId && !member.isOwner ? (
                  <Link
                    href={`/workspace/${workspaceId}/users/${member.userId}`}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    {content}
                  </div>
                )}
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
            {loadingMore ? "Загружаем…" : "Показать ещё"}
          </Button>
        </div>
      )}

      {workspaceId && (
        <InviteSheet
          workspaceId={workspaceId}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          canManageMembers={canManageMembers}
          canAdmin={canAdmin}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  )
}
