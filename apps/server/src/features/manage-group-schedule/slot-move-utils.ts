// Pure date math and decisions behind dragging a class in the admin calendar:
// «Только это занятие» (move one occurrence) and «Это и все следующие» (change
// a weekly slot from a date on). Dates are slot-local 'yyyy-mm-dd'; @db.Date
// columns arrive as UTC-midnight Dates.
import {
    addDaysYmd,
    dbDateToYmd,
    diffDaysYmd,
    ymdToDbDate,
} from '../../domains/subscriptions/freeze-dates'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    formatLocalDateTimeRu,
    isoDayOfWeek,
    wallClockToUtc,
} from '../attendance/attendance-utils'
import {
    crossesMidnight,
    dateRangesOverlap,
    parseTimeToMinutes,
    slotsOverlap,
} from './slot-utils'

type DatedSlot = {
    dayOfWeek: number
    effectiveFrom: Date | null
    effectiveUntil: Date | null
}

type TimedSlot = DatedSlot & {
    id: string
    startTime: string
    durationMin: number
}

type ExceptionRow = {
    slotId: string | null
    fromDate: Date
    untilDate: Date
    movedToSlotId: string | null
}

// A slot that runs on exactly one date — a moved class, or a one-off session.
export const isOneOffSlot = (s: {
    effectiveFrom: Date | null
    effectiveUntil: Date | null
}): boolean =>
    s.effectiveFrom !== null &&
    s.effectiveUntil !== null &&
    s.effectiveFrom.getTime() === s.effectiveUntil.getTime()

export const isoDowOfYmd = (ymd: string): number =>
    isoDayOfWeek(ymdToDbDate(ymd))

// Weekday + effective bounds, no exceptions.
export const slotRunsOn = (s: DatedSlot, ymd: string): boolean => {
    const d = ymdToDbDate(ymd)
    return (
        s.dayOfWeek === isoDayOfWeek(d) &&
        !(s.effectiveFrom && d < s.effectiveFrom) &&
        !(s.effectiveUntil && d > s.effectiveUntil)
    )
}

// The exception cancelling this slot's class on `ymd`, if any.
export const exceptionOn = <E extends ExceptionRow>(
    exceptions: E[],
    slotId: string,
    ymd: string,
): E | undefined => {
    const d = ymdToDbDate(ymd)
    return exceptions.find(
        (e) =>
            (e.slotId === null || e.slotId === slotId) &&
            e.fromDate <= d &&
            e.untilDate >= d,
    )
}

// The absolute start/end of a wall-clock class on a slot-local date.
export const classInstants = (
    ymd: string,
    startTime: string,
    durationMin: number,
    tz: string,
): { startAt: Date; endAt: Date } => {
    const startAt = wallClockToUtc(`${ymd}T${startTime}`, tz)
    return {
        startAt,
        endAt: new Date(startAt.getTime() + durationMin * 60_000),
    }
}

// Shared checks of both drags: the dragged class exists, is live, has not
// started, lands in the future and within one day. Returns both starts.
export const validateClassMove = (p: {
    slot: TimedSlot
    sessionDate: string
    newDate: string
    startTime: string
    durationMin: number
    exceptions: ExceptionRow[]
    tz: string
    now: Date
    // «Только это занятие» must not move the ghost a previous move left behind
    // (that would duplicate the class); a series split carries it along.
    refuseMovedAway: boolean
}): { originalStart: Date; newStart: Date; newEnd: Date } => {
    if (!slotRunsOn(p.slot, p.sessionDate)) {
        throw new BadRequestError({
            message: 'В эту дату занятия по расписанию нет',
        })
    }
    const exception = exceptionOn(p.exceptions, p.slot.id, p.sessionDate)
    if (exception && exception.movedToSlotId === null) {
        throw new BadRequestError({
            message: 'Занятие отменено — сначала верните его',
        })
    }
    if (exception && p.refuseMovedAway) {
        throw new BadRequestError({
            message: 'Занятие уже перенесено — перетащите его на новом месте',
        })
    }
    const originalStart = classInstants(
        p.sessionDate,
        p.slot.startTime,
        p.slot.durationMin,
        p.tz,
    ).startAt
    if (originalStart.getTime() <= p.now.getTime()) {
        throw new BadRequestError({
            message: 'Прошедшее занятие нельзя перенести',
        })
    }
    const next = classInstants(p.newDate, p.startTime, p.durationMin, p.tz)
    if (next.startAt.getTime() <= p.now.getTime()) {
        throw new BadRequestError({
            message: 'Нельзя перенести занятие в прошлое',
        })
    }
    if (crossesMidnight({ startTime: p.startTime, durationMin: p.durationMin })) {
        throw new BadRequestError({
            message: 'Слот пересекает полночь — разбейте его на два',
        })
    }
    return { originalStart, newStart: next.startAt, newEnd: next.endAt }
}

// Another live class of the group at the target date and time. The source
// slot itself only counts on another date (its own class there stays).
export const findMoveConflict = <S extends TimedSlot>(
    slots: S[],
    exceptions: ExceptionRow[],
    p: {
        sourceSlotId: string
        sessionDate: string
        newDate: string
        startTime: string
        durationMin: number
    },
): S | undefined =>
    slots.find(
        (s) =>
            !(s.id === p.sourceSlotId && p.newDate === p.sessionDate) &&
            slotRunsOn(s, p.newDate) &&
            slotsOverlap(s, p) &&
            !exceptionOn(exceptions, s.id, p.newDate),
    )

// Moving a moved class back onto its origin date and time restores it.
export const isRestoreMove = (
    slot: { movedFromSlotId: string | null; movedFromDate: Date | null },
    origin: { id: string; startTime: string; durationMin: number } | undefined,
    p: { newDate: string; startTime: string; durationMin: number },
): boolean =>
    origin !== undefined &&
    slot.movedFromSlotId === origin.id &&
    slot.movedFromDate !== null &&
    dbDateToYmd(slot.movedFromDate) === p.newDate &&
    origin.startTime === p.startTime &&
    origin.durationMin === p.durationMin

// ---- «Это и все следующие» ------------------------------------------------

export const MAX_SPLIT_SHIFT_DAYS = 6

// Days the series shifts by (newDate − fromDate); a drag stays within a week.
export const splitShiftDays = (fromDate: string, newDate: string): number => {
    const delta = diffDaysYmd(newDate, fromDate)
    if (Math.abs(delta) > MAX_SPLIT_SHIFT_DAYS) {
        throw new BadRequestError({
            message: `Серию можно сдвинуть не больше чем на ${MAX_SPLIT_SHIFT_DAYS} дней`,
        })
    }
    return delta
}

// Whether the slot has a class before fromDate that must keep its old time.
export const slotHasHistory = (
    effectiveFrom: Date | null,
    fromDate: string,
): boolean =>
    effectiveFrom === null ||
    addDaysYmd(fromDate, -7) >= dbDateToYmd(effectiveFrom)

type MergeCandidate = TimedSlot & {
    capacity: number | null
    movedFromSlotId: string | null
}

// A series of the group that ended the week before newDate with exactly the
// new weekday/time/capacity: dragging back onto it continues it (undo of a
// split) instead of creating a third slot.
export const findMergeTarget = <S extends MergeCandidate>(
    slots: S[],
    p: {
        slotId: string
        newDate: string
        startTime: string
        durationMin: number
        capacity: number | null
    },
): S | undefined => {
    const dow = isoDowOfYmd(p.newDate)
    const weekBefore = addDaysYmd(p.newDate, -7)
    return slots.find((s) => {
        if (s.id === p.slotId || s.movedFromSlotId !== null) return false
        if (s.effectiveUntil === null) return false
        const until = dbDateToYmd(s.effectiveUntil)
        return (
            s.dayOfWeek === dow &&
            s.startTime === p.startTime &&
            s.durationMin === p.durationMin &&
            s.capacity === p.capacity &&
            until < p.newDate &&
            until >= weekBefore
        )
    })
}

export type SplitPlan = {
    mode: 'merge' | 'inPlace' | 'cut'
    delta: number
    history: boolean
    // effectiveFrom of the slot carrying the series (inPlace; cut = newDate).
    targetFrom: string | null
    // effectiveUntil of the slot carrying the series.
    targetUntil: string | null
    // The source keeps its classes before fromDate.
    sourceUntil: string | null
    // Merged with nothing left on the source: delete it.
    deleteSource: boolean
}

export const planSplit = (p: {
    source: { effectiveFrom: Date | null; effectiveUntil: Date | null }
    fromDate: string
    newDate: string
    merge: boolean
}): SplitPlan => {
    const delta = splitShiftDays(p.fromDate, p.newDate)
    const history = slotHasHistory(p.source.effectiveFrom, p.fromDate)
    const targetUntil = p.source.effectiveUntil
        ? addDaysYmd(dbDateToYmd(p.source.effectiveUntil), delta)
        : null
    const mode = p.merge ? 'merge' : history ? 'cut' : 'inPlace'
    return {
        mode,
        delta,
        history,
        targetFrom:
            mode === 'cut'
                ? p.newDate
                : mode === 'inPlace' && p.source.effectiveFrom
                  ? p.newDate
                  : null,
        targetUntil,
        sourceUntil: history ? addDaysYmd(p.fromDate, -1) : null,
        deleteSource: p.merge && !history,
    }
}

// Another slot of the group running at the new weekday/time while the shifted
// series is in effect.
export const findSplitConflict = <S extends TimedSlot>(
    slots: S[],
    p: {
        excludeIds: string[]
        newDate: string
        targetUntil: string | null
        startTime: string
        durationMin: number
    },
): S | undefined => {
    const dow = isoDowOfYmd(p.newDate)
    const from = ymdToDbDate(p.newDate)
    const until = p.targetUntil ? ymdToDbDate(p.targetUntil) : null
    return slots.find(
        (s) =>
            !p.excludeIds.includes(s.id) &&
            s.dayOfWeek === dow &&
            slotsOverlap(s, p) &&
            dateRangesOverlap(from, until, s.effectiveFrom, s.effectiveUntil),
    )
}

export type ExceptionShiftPlan = {
    // Wholly from fromDate on: moves to the target, dates shifted.
    repoint: { id: string; fromDate: string; untilDate: string }[]
    // Straddles fromDate: the source keeps [from, fromDate−1] …
    truncate: { id: string; untilDate: string }[]
    // … and the target gets the rest, shifted.
    copies: {
        fromDate: string
        untilDate: string
        reason: string | null
        movedToSlotId: string | null
    }[]
}

export const planExceptionShift = (
    exceptions: {
        id: string
        fromDate: Date
        untilDate: Date
        reason: string | null
        movedToSlotId: string | null
    }[],
    fromDate: string,
    delta: number,
): ExceptionShiftPlan => {
    const plan: ExceptionShiftPlan = { repoint: [], truncate: [], copies: [] }
    for (const e of exceptions) {
        const from = dbDateToYmd(e.fromDate)
        const until = dbDateToYmd(e.untilDate)
        if (until < fromDate) continue
        if (from >= fromDate) {
            plan.repoint.push({
                id: e.id,
                fromDate: addDaysYmd(from, delta),
                untilDate: addDaysYmd(until, delta),
            })
            continue
        }
        plan.truncate.push({ id: e.id, untilDate: addDaysYmd(fromDate, -1) })
        plan.copies.push({
            fromDate: addDaysYmd(fromDate, delta),
            untilDate: addDaysYmd(until, delta),
            reason: e.reason,
            movedToSlotId: e.movedToSlotId,
        })
    }
    return plan
}

// ---- notification copy -----------------------------------------------------

const DAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const hhmm = (minutes: number): string =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

// «Пн 19:00–20:30»
export const weeklyLabel = (s: {
    dayOfWeek: number
    startTime: string
    durationMin: number
}): string =>
    `${DAY_SHORT[s.dayOfWeek] ?? s.dayOfWeek} ${s.startTime}–${hhmm(
        parseTimeToMinutes(s.startTime) + s.durationMin,
    )}`

// «Перенесено на 12.11 в 19:00» — the reason on the moved class's ghost.
export const movedReason = (newStart: Date, tz: string): string =>
    `Перенесено на ${formatLocalDateTimeRu(newStart, tz)}`

export const moveMessage = (
    groupName: string,
    oldStart: Date,
    newStart: Date,
    tz: string,
): string =>
    `«${groupName}»: ${formatLocalDateTimeRu(oldStart, tz)} → ${formatLocalDateTimeRu(newStart, tz)}`

export const splitMessage = (
    groupName: string,
    newDate: string,
    next: { dayOfWeek: number; startTime: string; durationMin: number },
    previous: { dayOfWeek: number; startTime: string; durationMin: number },
): string =>
    `«${groupName}»: с ${newDate.slice(8, 10)}.${newDate.slice(5, 7)} — ${weeklyLabel(next)} (было ${weeklyLabel(previous)})`
