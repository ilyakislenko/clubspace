"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  getScheduleOccupancy,
  type OccupancySlot,
  type ScheduleOccupancy,
} from "../../../../../../shared/api/analytics"
import {
  getGroup,
  type GroupDetails,
  type GroupDetailsMember,
} from "../../../../../../shared/api/groups"
import { DirectionChip } from "../../../../../../features/directions/DirectionChip"
import { CoachChip } from "../../../../../../features/groups/CoachChip"
import { GroupScheduleBlock } from "../../../../../../features/schedule/GroupScheduleBlock"
import { ScheduleSummary } from "../../../../../../features/schedule/ScheduleSummary"
import {
  classesLabel,
  periodLabel,
} from "../../../../../../features/subscriptions/subscription-display"
import {
  fillCellClass,
  formatAverage,
  formatPercent,
  personName,
  WEEKDAY_SHORT,
} from "../../../../../../shared/lib/analytics"
import { AT_RISK_CHIP, AT_RISK_LABEL } from "../../../../../../shared/lib/at-risk"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import { pluralRu } from "../../../../../../shared/lib/plural-ru"

export default function WorkspaceGroupPage() {
  const params = useParams<{ workspaceId: string; groupId: string }>()
  const workspaceId = params?.workspaceId
  const groupId = params?.groupId

  const [group, setGroup] = useState<GroupDetails | null>(null)
  const [occupancy, setOccupancy] = useState<ScheduleOccupancy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const backLink = (
    <Link
      href={`/workspace/${workspaceId}/groups`}
      className="text-xs text-muted-foreground hover:underline"
    >
      ← Группы и расписание
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
    .sort((a, b) =>
      a.role === b.role ? 0 : a.role === "primary" ? -1 : 1,
    )

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        {backLink}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{group.name}</h1>
              <DirectionChip direction={group.direction} />
            </div>
            <div className="text-sm text-muted-foreground">
              {group.gym ? (
                <Link
                  href={`/workspace/${workspaceId}/gyms/${group.gym.id}`}
                  className="hover:underline"
                >
                  {group.gym.name} · {group.gym.address}
                </Link>
              ) : (
                "Без зала"
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/workspace/${workspaceId}/schedule?group=${group.id}`}>
                В календаре
              </Link>
            </Button>
            {group.canEdit && (
              <Button asChild size="sm">
                <Link href={`/workspace/${workspaceId}/groups?edit=${group.id}`}>
                  Редактировать
                </Link>
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 ring-1 ring-inset ring-zinc-600/20">
            {group.memberCount}{" "}
            {pluralRu(group.memberCount, "ученик", "ученика", "учеников")}
          </span>
          {group.bookingMode === "BOOKING" && (
            <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700 ring-1 ring-inset ring-sky-600/20">
              Запись на занятие ·{" "}
              {group.capacity === null
                ? "без ограничения мест"
                : `${group.capacity} ${pluralRu(group.capacity, "место", "места", "мест")}`}
            </span>
          )}
        </div>
      </div>

      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        {group.canEdit ? (
          <GroupScheduleBlock
            workspaceId={workspaceId}
            group={group}
            onChanged={load}
          />
        ) : group.slots.length === 0 && group.exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Расписания пока нет.</p>
        ) : (
          <ScheduleSummary slots={group.slots} exceptions={group.exceptions} />
        )}
      </section>

      {occupancy && occupancy.slots.length > 0 && (
        <OccupancySection weeks={occupancy.weeks} slots={occupancy.slots} />
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Ученики</h2>
        {group.members.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            В группе пока нет учеников.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Ученик</th>
                  {group.canEdit && <th className="p-3">Абонемент</th>}
                  {group.canEdit && <th className="p-3">Риск ухода</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {group.members.map((m) => (
                  <MemberRow
                    key={m.userId}
                    workspaceId={workspaceId}
                    member={m}
                    showStatus={group.canEdit}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function MemberRow({
  workspaceId,
  member,
  showStatus,
}: {
  workspaceId: string
  member: GroupDetailsMember
  showStatus: boolean
}) {
  return (
    <tr>
      <td className="p-3">
        <Link
          href={`/workspace/${workspaceId}/users/${member.userId}`}
          className="font-medium hover:underline"
        >
          {personName(member)}
        </Link>
      </td>
      {showStatus && (
        <td className="p-3">
          {member.subscriptions.length === 0 ? (
            <span className="text-muted-foreground">Нет действующего</span>
          ) : (
            <ul className="space-y-1">
              {member.subscriptions.map((s) => {
                const classes = classesLabel(s)
                return (
                  <li key={s.id}>
                    <Link
                      href={`/workspace/${workspaceId}/subscriptions/plans/${s.planId}`}
                      className="hover:underline"
                    >
                      {s.planName}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · {periodLabel(s)}
                      {classes ? ` · ${classes}` : ""}
                    </span>
                    {!s.isPaid && (
                      <span className="ml-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700">
                        Ожидает оплаты
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </td>
      )}
      {showStatus && (
        <td className="p-3">
          {member.risk && (
            <span
              title={member.risk.text}
              className={`inline-block rounded px-1.5 py-0.5 text-xs ${AT_RISK_CHIP[member.risk.reason]}`}
            >
              {AT_RISK_LABEL[member.risk.reason]}
            </span>
          )}
        </td>
      )}
    </tr>
  )
}

function OccupancySection({
  weeks,
  slots,
}: {
  weeks: number
  slots: OccupancySlot[]
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Загрузка за {weeks} {pluralRu(weeks, "неделю", "недели", "недель")}</h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Когда</th>
              <th className="p-3 text-right">Проведено</th>
              <th className="p-3 text-right">Приходят</th>
              <th className="p-3 text-right">Мест</th>
              <th className="p-3 text-right">Заполненность</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {slots.map((s) => (
              <tr key={s.slotId}>
                <td className="whitespace-nowrap p-3">
                  {WEEKDAY_SHORT[s.dayOfWeek]} {s.startTime}
                </td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">
                  {s.held} из {s.scheduled}
                </td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">
                  {formatAverage(s.avgAttendance)}
                </td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">
                  {s.capacity}
                </td>
                <td className="whitespace-nowrap p-3 text-right">
                  <span
                    className={`inline-block rounded px-2 py-0.5 tabular-nums ${fillCellClass(s.fill)}`}
                  >
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
