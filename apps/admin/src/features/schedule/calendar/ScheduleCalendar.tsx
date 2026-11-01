"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  deleteGroupException,
  deleteGroupSlot,
  listGroups,
  listGyms,
  type Gym,
  type GroupSummary,
} from "../../../shared/api/groups"
import { fetchMe } from "../../../shared/api/me"
import {
  getSchedule,
  moveGroupOccurrence,
  splitGroupSlot,
  type WorkspaceSchedule,
} from "../../../shared/api/schedule"
import { errorMessage } from "../../../shared/lib/error-message"
import { useWorkspaceRealtime } from "../../../shared/realtime/useWorkspaceRealtime"
import { useDirectionScope } from "../../../shared/workspace/use-direction-scope"
import { useDirections } from "../../directions/use-directions"
import { AgendaView } from "./AgendaView"
import { personName, slotLabel } from "./calendar-format"
import {
  chunkRange,
  dayMonth,
  findConflicts,
  formatHm,
  isCalendarView,
  viewRange,
  wallClock,
  weekDays,
  type CalendarView,
  type HourRange,
} from "./calendar-helpers"
import {
  buildCalendarItems,
  EMPTY_FILTERS,
  type CalendarFilters,
  type CalendarItem,
  type ClassItem,
} from "./calendar-items"
import { CalendarHeader } from "./CalendarHeader"
import { ClassDetailsSheet } from "./ClassDetailsSheet"
import { CreateSlotDialog, type CreateSlotRequest } from "./CreateSlotDialog"
import { MonthView } from "./MonthView"
import { MoveDialog, type MoveScope } from "./MoveDialog"
import { TimeGridView } from "./TimeGridView"
import { UndoToast, type Toast } from "./UndoToast"
import type { DragTarget } from "./use-grid-drag"
import { YearView } from "./YearView"

const STORAGE_KEY = "clubspace:schedule-calendar"
const DEFAULT_HOURS: HourRange = { from: 8, to: 22 }
const DEFAULT_WORKING: HourRange = { from: 9, to: 22 }
const EMPTY_SCHEDULE: WorkspaceSchedule = { timezone: "UTC", sessions: [], events: [] }

type Stored = { view?: CalendarView; hours?: HourRange; workingHours?: HourRange }

const readStored = (): Stored => {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Stored
  } catch {
    return {}
  }
}

const browserTz = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

let toastSeq = 0

/**
 * «Занятия»: the club's schedule as a calendar (volt's big calendar ported to
 * ClubSpace) — day / week / month / year / list, drag a class to move it,
 * pull its bottom edge to change the duration, click an empty cell to add one.
 */
export function ScheduleCalendar({ workspaceId }: { workspaceId: string }) {
  const [view, setView] = useState<CalendarView>("week")
  const [anchor, setAnchor] = useState(() => wallClock(new Date(), browserTz()).ymd)
  const [filters, setFilters] = useState<CalendarFilters>(EMPTY_FILTERS)
  const [hours, setHours] = useState<HourRange>(DEFAULT_HOURS)
  const [workingHours, setWorkingHours] = useState<HourRange>(DEFAULT_WORKING)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  const [schedule, setSchedule] = useState<WorkspaceSchedule>(EMPTY_SCHEDULE)
  const [loadedRange, setLoadedRange] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [gyms, setGyms] = useState<Gym[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  const { directions } = useDirections(workspaceId)
  const scope = useDirectionScope(workspaceId)

  const [now, setNow] = useState(() => new Date())
  const [detailsKey, setDetailsKey] = useState<string | null>(null)
  const [move, setMove] = useState<{ item: ClassItem; target: DragTarget } | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [createRequest, setCreateRequest] = useState<CreateSlotRequest | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  // View / hours from the last visit; ?view=&date= deep links win.
  useEffect(() => {
    const stored = readStored()
    const params = new URLSearchParams(window.location.search)
    const urlView = params.get("view")
    const urlDate = params.get("date")
    if (isCalendarView(urlView)) setView(urlView)
    else if (isCalendarView(stored.view)) setView(stored.view)
    if (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate)) setAnchor(urlDate)
    if (stored.hours) setHours(stored.hours)
    if (stored.workingHours) setWorkingHours(stored.workingHours)
    setSettingsLoaded(true)
  }, [])

  useEffect(() => {
    if (!settingsLoaded) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ view, hours, workingHours }))
    const url = new URL(window.location.href)
    url.searchParams.set("view", view)
    url.searchParams.set("date", anchor)
    window.history.replaceState(window.history.state, "", url)
  }, [settingsLoaded, view, anchor, hours, workingHours])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Until the first answer names the club's zone, the browser's stands in.
  const tz = loadedRange ? schedule.timezone : browserTz()
  const clock = wallClock(now, tz)
  const today = clock.ymd
  const nowMin = clock.minutes

  const range = useMemo(() => viewRange(view, anchor), [view, anchor])
  const rangeKey = `${range.from}:${range.to}`

  // The range the newest request asked for: switching weeks quickly (or the
  // deep link replacing the default week) must not let an older, slower answer
  // paint the wrong days.
  const requestedRange = useRef(rangeKey)
  const refresh = useCallback(async () => {
    requestedRange.current = rangeKey
    try {
      const parts = await Promise.all(
        chunkRange(range).map((r) => getSchedule({ workspaceId, from: r.from, to: r.to })),
      )
      if (requestedRange.current !== rangeKey) return
      setSchedule({
        timezone: parts[0]?.timezone ?? "UTC",
        sessions: parts.flatMap((p) => p.sessions),
        // An event spanning two chunks comes back twice.
        events: [...new Map(parts.flatMap((p) => p.events).map((e) => [e.id, e])).values()],
      })
      setLoadedRange(rangeKey)
      setError(null)
    } catch (e) {
      if (requestedRange.current !== rangeKey) return
      setError(errorMessage(e, "Не удалось загрузить расписание"))
    } finally {
      if (requestedRange.current === rangeKey) setLoading(false)
    }
    // rangeKey captures `range`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, rangeKey])

  const reloadGroups = useCallback(async () => {
    try {
      const [g, gy] = await Promise.all([listGroups({ workspaceId }), listGyms({ workspaceId })])
      setGroups(g.data)
      setGyms(gy.data)
    } catch {
      // The calendar still works from the schedule; filters just get shorter.
    }
  }, [workspaceId])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  useEffect(() => {
    void reloadGroups()
    fetchMe()
      .then((me) => setMeId(me.id))
      .catch(() => setMeId(null))
  }, [reloadGroups])

  useWorkspaceRealtime(workspaceId, ["schedule", "classbookings", "substitutions"], () => void refresh())
  useWorkspaceRealtime(workspaceId, ["groups"], () => {
    void reloadGroups()
    void refresh()
  })

  // ---- who may do what ------------------------------------------------------
  // Owner / admin / head coach: everything. A direction manager: classes of
  // their directions. A plain coach: reads their own groups only.
  const canManageGroup = useCallback(
    (g: { direction: { id: string } | null }) =>
      scope.isAdmin || (scope.isDirectionManager && !!g.direction && scope.canManageDirection(g.direction.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope.isAdmin, scope.isDirectionManager, scope.managedDirectionIds],
  )
  const ownGroupIds = useMemo(() => {
    if (scope.isAdmin || scope.isDirectionManager) return null
    return new Set(
      groups.filter((g) => meId && g.coaches.some((c) => c.userId === meId)).map((g) => g.id),
    )
  }, [scope.isAdmin, scope.isDirectionManager, groups, meId])
  const creatableGroups = useMemo(() => groups.filter((g) => canManageGroup(g)), [groups, canManageGroup])

  const nowMs = now.getTime()
  const items = useMemo(
    () =>
      buildCalendarItems(schedule, {
        filters,
        onlyGroupIds: ownGroupIds,
        canEdit: (s) => canManageGroup(s.group) && new Date(s.startAt).getTime() > nowMs,
      }),
    [schedule, filters, ownGroupIds, canManageGroup, nowMs],
  )
  // Conflicts look at the whole club, not just what the filters show.
  const conflictPool = useMemo(
    () =>
      buildCalendarItems(schedule, {
        filters: EMPTY_FILTERS,
        onlyGroupIds: null,
        canEdit: () => false,
      }).filter((it) => !it.cancelled),
    [schedule],
  )
  const conflictsForMove = useCallback(
    (item: ClassItem, target: DragTarget) =>
      findConflicts(
        { key: item.key, date: target.date, startMin: target.startMin, endMin: target.endMin, gymId: item.gymId, coachIds: item.coachIds },
        conflictPool,
      ),
    [conflictPool],
  )
  const conflictsForCreate = useCallback(
    (p: { date: string; startMin: number; endMin: number; group: GroupSummary }) =>
      findConflicts(
        { key: null, date: p.date, startMin: p.startMin, endMin: p.endMin, gymId: p.group.gym?.id ?? null, coachIds: [p.group.coach.id] },
        conflictPool,
      ),
    [conflictPool],
  )

  const detailsItem = detailsKey ? (items.find((it) => it.key === detailsKey) ?? null) : null

  // ---- actions ----------------------------------------------------------------
  const showToast = (t: Omit<Toast, "id">) => setToast({ ...t, id: ++toastSeq })
  const dismissToast = useCallback(() => setToast(null), [])

  const requestMove = (item: ClassItem, target: DragTarget) => {
    if (target.date < today || (target.date === today && target.startMin <= nowMin)) {
      showToast({ tone: "error", message: "Нельзя перенести занятие в прошлое" })
      return
    }
    setMoveError(null)
    setDetailsKey(null)
    setMove({ item, target })
  }

  const confirmMove = async (scopeKind: MoveScope, notify: boolean) => {
    if (!move) return
    const { item, target } = move
    const s = item.session
    const back = {
      startTime: formatHm(item.startMin),
      durationMin: item.endMin - item.startMin,
      notify,
    }
    const next = {
      startTime: formatHm(target.startMin),
      durationMin: target.endMin - target.startMin,
      notify,
    }
    setMoveBusy(true)
    setMoveError(null)
    try {
      if (scopeKind === "one") {
        const res = await moveGroupOccurrence({
          workspaceId,
          groupId: s.groupId,
          slotId: s.slotId,
          sessionDate: item.date,
          data: { newDate: target.date, ...next },
        })
        showToast({
          tone: "success",
          message: res.restored
            ? `Занятие вернулось на место: ${slotLabel(target)}`
            : `Занятие перенесено: ${slotLabel(target)}`,
          undo: async () => {
            await moveGroupOccurrence({
              workspaceId,
              groupId: s.groupId,
              slotId: res.slotId,
              sessionDate: res.sessionDate,
              data: { newDate: item.date, ...back },
            })
            await refresh()
          },
        })
      } else {
        const res = await splitGroupSlot({
          workspaceId,
          groupId: s.groupId,
          slotId: s.slotId,
          data: { fromDate: item.date, newDate: target.date, ...next },
        })
        showToast({
          tone: "success",
          message: `Расписание «${item.title}» изменено с ${dayMonth(target.date)}`,
          undo: async () => {
            await splitGroupSlot({
              workspaceId,
              groupId: s.groupId,
              slotId: res.slot.id,
              data: { fromDate: target.date, newDate: item.date, ...back },
            })
            await refresh()
          },
        })
      }
      setMove(null)
      await refresh()
      void reloadGroups()
    } catch (e) {
      setMoveError(errorMessage(e, "Не удалось перенести занятие"))
    } finally {
      setMoveBusy(false)
    }
  }

  const openItem = (it: CalendarItem) => setDetailsKey(it.key)
  const openDay = (date: string) => {
    setAnchor(date)
    setView("day")
  }

  // The month grid also shows the edges of the neighbouring months; count the month.
  const counted = view === "month" ? viewRange("agenda", anchor) : range
  const classCount = items.filter(
    (it) => it.kind === "class" && !it.cancelled && it.date >= counted.from && it.date <= counted.to,
  ).length

  const coachOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const g of groups) {
      for (const c of g.coaches) if (!seen.has(c.userId)) seen.set(c.userId, personName(c))
    }
    return [...seen.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"))
  }, [groups])
  const groupOptions = useMemo(
    () =>
      groups
        .filter((g) => !ownGroupIds || ownGroupIds.has(g.id))
        .map((g) => ({ id: g.id, label: g.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [groups, ownGroupIds],
  )
  const gymOptions = useMemo(() => gyms.map((g) => ({ id: g.id, label: g.name })), [gyms])

  const gridProps = {
    items,
    today,
    nowMin,
    hours,
    workingHours,
    canCreate: creatableGroups.length > 0,
    hasConflict: (item: ClassItem, target: DragTarget) => conflictsForMove(item, target).length > 0,
    onCreateAt: (date: string, startMin: number) => setCreateRequest({ date, startMin }),
    onOpenItem: openItem,
    onDrop: requestMove,
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Занятия</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Расписание всех групп и событий клуба. Перетащите занятие, чтобы перенести его, потяните за
          нижний край — чтобы изменить длительность, нажмите на пустую клетку — чтобы добавить занятие.
        </p>
      </div>

      <CalendarHeader
        view={view}
        onViewChange={setView}
        anchor={anchor}
        onAnchorChange={setAnchor}
        today={today}
        classCount={classCount}
        filters={filters}
        onFiltersChange={setFilters}
        gyms={gymOptions}
        coaches={coachOptions}
        groups={groupOptions}
        directions={directions}
        hours={hours}
        onHoursChange={setHours}
        workingHours={workingHours}
        onWorkingHoursChange={setWorkingHours}
      />

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="relative" aria-busy={loading}>
        {loading && loadedRange === null ? (
          <div className="h-[calc(100svh-17rem)] min-h-[420px] animate-pulse rounded-lg border border-border bg-muted" />
        ) : view === "week" ? (
          <TimeGridView {...gridProps} days={weekDays(anchor)} onOpenDay={openDay} />
        ) : view === "day" ? (
          <TimeGridView {...gridProps} days={[anchor]} />
        ) : view === "month" ? (
          <MonthView anchor={anchor} items={items} today={today} onOpenItem={openItem} onOpenDay={openDay} onDrop={requestMove} />
        ) : view === "year" ? (
          <YearView
            anchor={anchor}
            items={items}
            today={today}
            onOpenDay={openDay}
            onOpenMonth={(d) => {
              setAnchor(d)
              setView("month")
            }}
          />
        ) : (
          <AgendaView
            items={items.filter((it) => it.date >= range.from && it.date <= range.to)}
            today={today}
            onOpenItem={openItem}
          />
        )}
        {loading && loadedRange !== null && (
          <div className="pointer-events-none absolute right-3 top-3 z-40 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
            Обновляем…
          </div>
        )}
      </div>

      <ClassDetailsSheet
        workspaceId={workspaceId}
        item={detailsItem}
        group={
          detailsItem?.kind === "class"
            ? groups.find((g) => g.id === detailsItem.session.groupId)
            : undefined
        }
        canManage={detailsItem?.kind === "class" && canManageGroup(detailsItem.session.group)}
        onClose={() => setDetailsKey(null)}
        onMoveRequest={requestMove}
        onCancelled={(item, exception) => {
          setDetailsKey(null)
          showToast({
            tone: "success",
            message: `«${item.title}» ${slotLabel(item)} отменено`,
            // A booking class has already released its places — no cheap undo.
            undo: item.session.booking
              ? undefined
              : async () => {
                  await deleteGroupException({ workspaceId, groupId: item.session.groupId, exceptionId: exception.id })
                  await Promise.all([refresh(), reloadGroups()])
                },
          })
          void refresh()
          void reloadGroups()
        }}
        onRestored={() => {
          showToast({ tone: "success", message: "Занятие возвращено в расписание" })
          void refresh()
          void reloadGroups()
        }}
        onChanged={() => void refresh()}
      />

      <MoveDialog
        move={move}
        conflicts={move ? conflictsForMove(move.item, move.target) : []}
        busy={moveBusy}
        error={moveError}
        onCancel={() => setMove(null)}
        onConfirm={(s, notify) => void confirmMove(s, notify)}
      />

      <CreateSlotDialog
        workspaceId={workspaceId}
        request={createRequest}
        groups={creatableGroups}
        conflictsFor={conflictsForCreate}
        onClose={() => setCreateRequest(null)}
        onCreated={(slot, group) => {
          setCreateRequest(null)
          showToast({
            tone: "success",
            message: `Занятие «${group.name}» добавлено`,
            undo: async () => {
              await deleteGroupSlot({ workspaceId, groupId: group.id, slotId: slot.id })
              await Promise.all([refresh(), reloadGroups()])
            },
          })
          void refresh()
          void reloadGroups()
        }}
      />

      <UndoToast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
