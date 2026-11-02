// The rules of «Запись на занятие» (groups in BOOKING mode) that need no
// database: capacity / window / deadline resolution, the late-cancel test and
// which of a member's abonements may hold a place. See
// docs/design/2026-11-01-class-booking.md.
import { scopeCoversDirection } from '../subscriptions/current-subscriptions'
import type { ClubVocabulary } from '../../shared/utils/club-vocabulary'

export const LIVE_BOOKING_STATUSES = ['BOOKED', 'WAITLISTED'] as const

const HOUR_MS = 3_600_000

// Spots of one class: the date's override, else the slot's, else the group's.
// null = unlimited.
export const effectiveCapacity = (p: {
    occurrence: number | null | undefined
    slot: number | null
    group: number | null
}): number | null => p.occurrence ?? p.slot ?? p.group ?? null

export type BookingSettings = {
    windowDays: number
    cancelHours: number
    lateCancelBurn: boolean
    noShowBurn: boolean
}

// The club's booking settings with the group's overrides applied.
export const bookingSettings = (
    workspace: {
        bookingWindowDays: number
        bookingCancelHours: number
        bookingLateCancelBurn: boolean
        bookingNoShowBurn: boolean
    },
    group: { bookingWindowDays: number | null; bookingCancelHours: number | null },
): BookingSettings => ({
    windowDays: group.bookingWindowDays ?? workspace.bookingWindowDays,
    cancelHours: group.bookingCancelHours ?? workspace.bookingCancelHours,
    lateCancelBurn: workspace.bookingLateCancelBurn,
    noShowBurn: workspace.bookingNoShowBurn,
})

// Until when a booking may be cancelled without consequences.
export const cancelDeadline = (startAt: Date, cancelHours: number): Date =>
    new Date(startAt.getTime() - cancelHours * HOUR_MS)

// A cancel is late when a held spot is given up after the deadline — unless the
// member got that spot from the waitlist after the deadline (they never had the
// chance to cancel in time). A waitlist place is never late.
export const isLateCancel = (p: {
    status: string
    promotedAt: Date | null
    startAt: Date
    cancelHours: number
    now: Date
}): boolean => {
    if (p.status !== 'BOOKED') return false
    const deadline = cancelDeadline(p.startAt, p.cancelHours).getTime()
    if (p.now.getTime() <= deadline) return false
    return !(p.promotedAt && p.promotedAt.getTime() > deadline)
}

export type BookingBlock =
    | 'no_abonement'
    | 'ends_before'
    | 'frozen'
    | 'no_classes'
    | 'classes_allocated'

export const bookingBlockMessage = (block: BookingBlock, v: ClubVocabulary): string => {
    switch (block) {
        case 'no_abonement':
            return `Нет абонемента, который действует на это занятие — оформите его у ${v.coach.gen}`
        case 'ends_before':
            return 'Абонемент закончится раньше этого занятия'
        case 'frozen':
            return 'Абонемент заморожен на день занятия — записаться нельзя'
        case 'no_classes':
            return `На абонементе не осталось занятий — продлите его у ${v.coach.gen}`
        case 'classes_allocated':
            return 'Все занятия абонемента уже распределены по записям. Отмените одну из записей или продлите абонемент'
    }
}

export type BookingAbonement = {
    status: string
    startDate: Date | null
    endDate: Date | null
    classesTotal: number | null
    classesRemaining: number | null
    // Scope snapshot; empty = club-wide.
    directionIds: readonly string[]
    // Frozen on the class's club day.
    frozen: boolean
}

// May the member hold a place in this class? Needs a current abonement the
// visit precedence could spend on it (scope covers the class's direction, it
// runs at the class start, not frozen that day, a class left or time-based).
// Class packs can't be over-promised: the member's other live bookings of
// classes those packs cover must stay below the classes left together, unless
// a time-based abonement pays. The refusal names the first condition no
// abonement passes. null = may book.
export const bookingBlock = (p: {
    abonements: readonly BookingAbonement[]
    classDirectionId: string | null
    startAt: Date
    // Directions of the classes of the member's other live bookings.
    heldDirections: ReadonlyArray<string | null>
}): BookingBlock | null => {
    const covering = p.abonements.filter(
        (a) =>
            a.status === 'ACTIVE' &&
            scopeCoversDirection(a.directionIds, p.classDirectionId),
    )
    if (covering.length === 0) return 'no_abonement'
    const at = p.startAt.getTime()
    const running = covering.filter(
        (a) =>
            (!a.startDate || a.startDate.getTime() <= at) &&
            (!a.endDate || a.endDate.getTime() > at),
    )
    if (running.length === 0) return 'ends_before'
    const unfrozen = running.filter((a) => !a.frozen)
    if (unfrozen.length === 0) return 'frozen'
    const payers = unfrozen.filter(
        (a) => a.classesTotal === null || (a.classesRemaining ?? 0) > 0,
    )
    if (payers.length === 0) return 'no_classes'
    if (payers.some((a) => a.classesTotal === null)) return null
    const left = payers.reduce((sum, a) => sum + (a.classesRemaining ?? 0), 0)
    const held = p.heldDirections.filter((d) =>
        payers.some((a) => scopeCoversDirection(a.directionIds, d)),
    ).length
    return held >= left ? 'classes_allocated' : null
}

// Positions (1-based) of the waitlisted bookings of one class, oldest first.
export const waitlistPositions = (
    rows: ReadonlyArray<{ id: string; status: string; createdAt: Date }>,
): Map<string, number> => {
    const queue = rows
        .filter((r) => r.status === 'WAITLISTED')
        .sort(
            (a, b) =>
                a.createdAt.getTime() - b.createdAt.getTime() ||
                (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
    return new Map(queue.map((r, i) => [r.id, i + 1]))
}
