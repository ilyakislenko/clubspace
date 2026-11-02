// Schedule occupancy: per weekly slot, the average attendance of the classes
// a coach took attendance for against the slot's capacity (an explicit limit,
// else the group roster), the weekday × hour heatmap per gym and rule-based
// suggestions. Pure; rows come from AnalyticsSlotOccurrence. Slot times are
// wall-clock in the gym's (or club's) timezone, so weekday/hour need no
// conversion.

import type { ClubVocabulary } from '../../shared/utils/club-vocabulary'

export const OCCUPANCY_RULES = {
    // Average attendance at or above this share of capacity = demand exceeds
    // what the slot can take.
    fullFill: 0.9,
    // Below this share the slot is weak.
    weakFill: 0.4,
    // A slot needs this many classes with attendance to be judged.
    minHeld: 2,
    top: 5,
    defaultWeeks: 8,
    maxWeeks: 26,
} as const

export const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const

export type OccurrenceRow = {
    groupId: string
    slotId: string
    gymId: string | null
    sessionDate: string // YYYY-MM-DD, slot-local
    dayOfWeek: number
    startTime: string
    held: boolean
    attended: number
    roster: number
    capacity: number | null
    booked: number
    missedBookings: number
}

export type SlotStat = {
    slotId: string
    groupId: string
    gymId: string | null
    dayOfWeek: number
    startTime: string
    scheduled: number
    held: number
    avgAttendance: number
    capacity: number
    // avgAttendance / capacity; null when capacity is 0 or nothing was held.
    fill: number | null
    booked: number
    missedBookings: number
}

export type HeatCell = {
    dayOfWeek: number
    hour: number
    slots: number
    avgAttendance: number
    capacity: number
    fill: number | null
}

const round1 = (x: number): number => Math.round(x * 10) / 10

export const summarizeSlots = (
    rows: ReadonlyArray<OccurrenceRow>,
    fromYmd: string,
): SlotStat[] => {
    const bySlot = new Map<string, OccurrenceRow[]>()
    for (const r of rows) {
        if (r.sessionDate < fromYmd) continue
        const list = bySlot.get(r.slotId)
        if (list) list.push(r)
        else bySlot.set(r.slotId, [r])
    }
    const out: SlotStat[] = []
    for (const [slotId, list] of bySlot) {
        const latest = list.reduce((a, b) => (b.sessionDate > a.sessionDate ? b : a))
        const held = list.filter((r) => r.held)
        const attended = held.reduce((sum, r) => sum + r.attended, 0)
        const avg = held.length > 0 ? attended / held.length : 0
        const capacity = latest.capacity ?? latest.roster
        out.push({
            slotId,
            groupId: latest.groupId,
            gymId: latest.gymId,
            dayOfWeek: latest.dayOfWeek,
            startTime: latest.startTime,
            scheduled: list.length,
            held: held.length,
            avgAttendance: round1(avg),
            capacity,
            fill: held.length > 0 && capacity > 0 ? Math.round((avg / capacity) * 100) / 100 : null,
            booked: list.reduce((sum, r) => sum + r.booked, 0),
            missedBookings: list.reduce((sum, r) => sum + r.missedBookings, 0),
        })
    }
    return out.sort(
        (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    )
}

// Weekday × start hour per gym (null gym = classes without a gym).
export const buildHeatmap = (
    slots: ReadonlyArray<SlotStat>,
): Map<string | null, HeatCell[]> => {
    const byGym = new Map<string | null, Map<string, HeatCell>>()
    for (const s of slots) {
        if (s.held === 0) continue
        const hour = Number(s.startTime.slice(0, 2))
        const key = `${s.dayOfWeek}:${hour}`
        let cells = byGym.get(s.gymId)
        if (!cells) {
            cells = new Map()
            byGym.set(s.gymId, cells)
        }
        const cell = cells.get(key) ?? {
            dayOfWeek: s.dayOfWeek,
            hour,
            slots: 0,
            avgAttendance: 0,
            capacity: 0,
            fill: null,
        }
        cell.slots += 1
        cell.avgAttendance = round1(cell.avgAttendance + s.avgAttendance)
        cell.capacity += s.capacity
        cell.fill =
            cell.capacity > 0
                ? Math.round((cell.avgAttendance / cell.capacity) * 100) / 100
                : null
        cells.set(key, cell)
    }
    return new Map(
        [...byGym.entries()].map(([gymId, cells]) => [
            gymId,
            [...cells.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour),
        ]),
    )
}

// Slots with enough classes held to be judged, with a known fill.
const judged = <T extends SlotStat>(slots: ReadonlyArray<T>): (T & { fill: number })[] =>
    slots.filter(
        (s): s is T & { fill: number } =>
            s.fill !== null && s.held >= OCCUPANCY_RULES.minHeld,
    )

export const weakestSlots = <T extends SlotStat>(slots: ReadonlyArray<T>): (T & { fill: number })[] =>
    judged(slots)
        .filter((s) => s.fill < OCCUPANCY_RULES.weakFill)
        .sort((a, b) => a.fill - b.fill || a.avgAttendance - b.avgAttendance)
        .slice(0, OCCUPANCY_RULES.top)

export const strongestSlots = <T extends SlotStat>(slots: ReadonlyArray<T>): (T & { fill: number })[] =>
    judged(slots)
        .sort((a, b) => b.fill - a.fill || b.avgAttendance - a.avgAttendance)
        .slice(0, OCCUPANCY_RULES.top)

export type SlotNames = { groupName: string; gymName: string | null }

export type OccupancySuggestion = {
    kind: 'add_class' | 'rethink_slot'
    slotId: string
    text: string
}

export const slotLabel = (s: Pick<SlotStat, 'dayOfWeek' | 'startTime'>): string =>
    `${WEEKDAYS_RU[s.dayOfWeek - 1]} ${s.startTime}`

const where = (n: SlotNames): string =>
    n.gymName ? `«${n.groupName}», ${n.gymName}` : `«${n.groupName}»`

// Best time windows: where the average attendance reaches the capacity the
// club should add a class next to it; the weakest slots are candidates to
// move or merge.
export const suggestOccupancyActions = (
    slots: ReadonlyArray<SlotStat>,
    names: ReadonlyMap<string, SlotNames>,
    vocabulary: ClubVocabulary,
): OccupancySuggestion[] => {
    const out: OccupancySuggestion[] = []
    for (const s of judged(slots)
        .filter((x) => x.fill >= OCCUPANCY_RULES.fullFill)
        .sort((a, b) => b.fill - a.fill)
        .slice(0, OCCUPANCY_RULES.top)) {
        const n = names.get(s.slotId)
        if (!n) continue
        out.push({
            kind: 'add_class',
            slotId: s.slotId,
            text: `${slotLabel(s)} ${where(n)}: в среднем ${String(s.avgAttendance).replace('.', ',')} из ${s.capacity} (${Math.round(s.fill * 100)}%). Спрос выше вместимости — добавьте ${vocabulary.session.acc} в соседний час или параллельную группу.`,
        })
    }
    for (const s of weakestSlots(slots)) {
        const n = names.get(s.slotId)
        if (!n) continue
        out.push({
            kind: 'rethink_slot',
            slotId: s.slotId,
            text: `${slotLabel(s)} ${where(n)}: в среднем ${String(s.avgAttendance).replace('.', ',')} из ${s.capacity} (${Math.round(s.fill * 100)}%). Подумайте о переносе времени или объединении с другой группой.`,
        })
    }
    return out
}
