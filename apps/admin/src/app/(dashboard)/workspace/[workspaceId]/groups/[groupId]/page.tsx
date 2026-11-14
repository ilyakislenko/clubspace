"use client"

import { MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { cap } from "@clubspace/ui-kit/brand"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@clubspace/ui-kit/ui"

import { DirectionChip } from "../../../../../../features/directions/DirectionChip"
import { AddCoachButton } from "../../../../../../features/groups/AddCoachButton"
import { CoachChip } from "../../../../../../features/groups/CoachChip"
import { GroupFormSheet } from "../../../../../../features/groups/GroupFormSheet"
import { GroupRoster } from "../../../../../../features/groups/GroupRoster"
import { ScheduleSummary } from "../../../../../../features/schedule/ScheduleSummary"
import {
  getScheduleOccupancy,
  type OccupancySlot,
  type ScheduleOccupancy,
} from "../../../../../../shared/api/analytics"
import { deleteGroup, getGroup, type GroupDetails } from "../../../../../../shared/api/groups"
import { listAllStaffMembers, type WorkspaceMember } from "../../../../../../shared/api/members"
import {
  fillCellClass,
  formatAverage,
  formatPercent,
  personName,
  WEEKDAY_SHORT,
} from "../../../../../../shared/lib/analytics"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import { isClubAdmin } from "../../../../../../shared/lib/permissions"
import { pluralRu } from "../../../../../../shared/lib/plural-ru"
import { useMyMembership } from "../../../../../../shared/lib/use-my-membership"
import { useVocabulary } from "../../../../../../shared/lib/vocabulary"
import { confirmDialog } from "../../../../../../shared/ui/confirm-dialog"

// The group card: hall, coaches, mode, the schedule read-only (the calendar
// edits it) and the roster, paged.
export default function WorkspaceGroupPage() {
  const params = useParams<{ workspaceId: string; groupId: string }>()
  const workspaceId = params?.workspaceId
  const groupId = params?.groupId
  const router = useRouter()
  const vocabulary = useVocabulary()
  const linkPlans = isClubAdmin(useMyMembership(workspaceId))

  const [group, setGroup] = useState<GroupDetails | null>(null)
  const [occupancy, setOccupancy] = useState<ScheduleOccupancy | null>(null)
  const [staff, setStaff] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!workspaceId || !groupId) return
    try {
      setGroup(await getGroup({ workspaceId, groupId }))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить группу"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, groupId])

  useEffect(() => {
    void load()
  }, [load])

  // «Аналитика → Загрузка расписания» narrowed to this group. The server
  // scopes it like the analytics screen; an empty answer just hides the block.
  useEffect(() => {
    if (!workspaceId || !groupId) return
    void getScheduleOccupancy({ workspaceId, groupId })
      .then(setOccupancy)
      .catch(() => setOccupancy(null))
  }, [workspaceId, groupId])

  // Assistant picker: staff only (a handful), for whoever runs the group.
  const canEdit = group?.canEdit ?? false
  useEffect(() => {
    if (!workspaceId || !canEdit) return
    void listAllStaffMembers({ workspaceId })
      .then(setStaff)
      .catch(() => setStaff([]))
  }, [workspaceId, canEdit])

  const backLink = (
    <Link href={`/workspace/${workspaceId}/groups`} className="text-xs text-muted-foreground hover:underline">
      ← Группы и залы
    </Link>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    )
  }

  if (error || !group || !workspaceId) {
    return (
      <div className="space-y-4">
        {backLink}
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? "Группа не найдена"}
        </p>
      </div>
    )
  }

  const coaches = group.coaches
    .slice()
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "primary" ? -1 : 1))

  const handleDelete = async () => {
    const n = group.memberCount
    const consequences = [
      n > 0 &&
        `В группе ${n} ${pluralRu(n, "ученик", "ученика", "учеников")} — ${n === 1 ? "он останется" : "они останутся"} в клубе без группы.`,
      group.slots.length > 0 && `${cap(vocabulary.session.nomPl)} группы исчезнут из расписания.`,
    ]
      .filter(Boolean)
      .join(" ")
    if (
      !(await confirmDialog({
        title: `Удалить группу «${group.name}»?`,
        description: consequences || undefined,
        confirmLabel: "Удалить группу",
        destructive: true,
      }))
    ) {
      return
    }
    setDeleting(true)
    try {
      await deleteGroup({ workspaceId, groupId: group.id })
      router.push(`/workspace/${workspaceId}/groups`)
    } catch (err) {
      setError(errorMessage(err, "Не удалось удалить группу"))
      setDeleting(false)
    }
  }

  const bookingText =
    group.bookingMode === "BOOKING"
      ? [
          `Запись на ${vocabulary.session.acc}`,
          group.capacity === null
            ? "без ограничения мест"
            : `${group.capacity} ${pluralRu(group.capacity, "место", "места", "мест")}`,
          group.bookingWindowDays !== null &&
            `запись за ${group.bookingWindowDays} ${pluralRu(group.bookingWindowDays, "день", "дня", "дней")}`,
          group.bookingCancelHours !== null &&
            `бесплатная отмена за ${group.bookingCancelHours} ${pluralRu(group.bookingCancelHours, "час", "часа", "часов")}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Постоянная группа"

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        {backLink}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{group.name}</h1>
            <DirectionChip direction={group.direction} />
          </div>
          {canEdit && (
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" onClick={() => setEditOpen(true)}>
                Изменить
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="Ещё" disabled={deleting}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive" onSelect={() => void handleDelete()}>
                    Удалить группу
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem,1fr]">
        <dt className="text-muted-foreground">Зал</dt>
        <dd>
          {group.gym ? (
            <Link href={`/workspace/${workspaceId}/gyms/${group.gym.id}`} className="hover:underline">
              {group.gym.name}
              <span className="text-muted-foreground"> · {group.gym.address}</span>
            </Link>
          ) : (
            <span className="text-amber-700">Без зала — выберите в «Изменить»</span>
          )}
        </dd>
        <dt className="text-muted-foreground">{cap(vocabulary.coach.nomPl)}</dt>
        <dd className="flex flex-wrap items-center gap-2 text-xs">
          {coaches.map((c) => (
            <CoachChip
              key={c.userId}
              workspaceId={workspaceId}
              groupId={group.id}
              userId={c.userId}
              name={personName(c)}
              role={c.role}
              onRemoved={load}
              onError={setError}
            />
          ))}
          {canEdit && (
            <AddCoachButton
              workspaceId={workspaceId}
              groupId={group.id}
              existingCoachIds={new Set(group.coaches.map((c) => c.userId))}
              members={staff}
              onAdded={load}
              onError={setError}
            />
          )}
        </dd>
        <dt className="text-muted-foreground">Режим</dt>
        <dd>{bookingText}</dd>
        <dt className="text-muted-foreground">Учеников</dt>
        <dd className="tabular-nums">{group.memberCount}</dd>
      </dl>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Расписание</h2>
          <Button asChild size="sm" variant="outline">
            <Link href={`/workspace/${workspaceId}/schedule?group=${group.id}`}>Изменить в расписании</Link>
          </Button>
        </div>
        <ScheduleSummary slots={group.slots} exceptions={group.exceptions} />
      </section>

      {occupancy && occupancy.slots.length > 0 && (
        <OccupancySection weeks={occupancy.weeks} slots={occupancy.slots} />
      )}

      <GroupRoster
        workspaceId={workspaceId}
        groupId={group.id}
        canEdit={canEdit}
        linkPlans={linkPlans}
        onChanged={() => void load()}
      />

      <GroupFormSheet
        workspaceId={workspaceId}
        open={editOpen}
        onOpenChange={setEditOpen}
        group={group}
        onSaved={load}
      />
    </div>
  )
}

function OccupancySection({ weeks, slots }: { weeks: number; slots: OccupancySlot[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">
        Загрузка за {weeks} {pluralRu(weeks, "неделю", "недели", "недель")}
      </h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Когда</th>
              <th className="px-3 py-2 text-right font-medium">Проведено</th>
              <th className="px-3 py-2 text-right font-medium">Приходят</th>
              <th className="px-3 py-2 text-right font-medium">Мест</th>
              <th className="px-3 py-2 text-right font-medium">Заполненность</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {slots.map((s) => (
              <tr key={s.slotId}>
                <td className="whitespace-nowrap px-3 py-2">
                  {WEEKDAY_SHORT[s.dayOfWeek]} {s.startTime}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {s.held} из {s.scheduled}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {formatAverage(s.avgAttendance)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{s.capacity}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <span className={`inline-block rounded px-2 py-0.5 tabular-nums ${fillCellClass(s.fill)}`}>
                    {formatPercent(s.fill)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
