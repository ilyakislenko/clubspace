import { scopeCoversDirection } from '../../domains/subscriptions/current-subscriptions'
import { isSubscriptionUsable } from '../../domains/subscriptions/subscription-status'

// Most future classes one member can hold a booking for at once.
export const MAX_OPEN_DROP_INS = 5

export type DropInBlockReason =
    | 'feature_off'
    | 'not_member'
    | 'inactive'
    | 'no_subscription'
    | 'no_classes'
    | 'classes_allocated'
    | 'too_many_bookings'

export const DROP_IN_BLOCK_MESSAGES: Record<DropInBlockReason, string> = {
    feature_off: 'Гостевые визиты в другие группы отключены в клубе',
    not_member: 'Запись в другие группы доступна участникам клуба',
    inactive: 'Ваше участие в клубе приостановлено — обратитесь к тренеру',
    no_subscription:
        'Чтобы записаться в другую группу, нужен действующий абонемент — оформите его у тренера',
    no_classes: 'На абонементе не осталось занятий — продлите его у тренера',
    classes_allocated:
        'Все занятия абонемента уже распределены по записям. Отмените одну из записей или продлите абонемент',
    too_many_bookings: `Можно записаться не больше чем на ${MAX_OPEN_DROP_INS} тренировок вперёд`,
}

export const DROP_IN_ENDS_BEFORE_CLASS_MESSAGE =
    'Абонемент закончится раньше этой тренировки'

export const DROP_IN_NOT_COVERED_MESSAGE =
    'Ни один ваш абонемент не действует на тренировки этой группы'

// Forbidden vs bad-request: the first three are about who you are, the rest
// about what you hold.
export const DROP_IN_FORBIDDEN_REASONS: ReadonlySet<DropInBlockReason> =
    new Set(['feature_off', 'not_member', 'inactive'])

// Reasons that depend on how many bookings are already held, so re-sending a
// booking that already exists must still succeed (idempotent POST).
export const DROP_IN_COUNT_REASONS: ReadonlySet<DropInBlockReason> = new Set([
    'classes_allocated',
    'too_many_bookings',
])

// One of the member's current abonements, as the drop-in rules read it.
// classesRemaining null = time-based (no class balance). directionIds = scope
// snapshot, empty = club-wide.
export type DropInAbonement = {
    status: string
    startDate: Date | null
    endDate: Date | null
    classesRemaining: number | null
    directionIds: readonly string[]
}

// Why this member can't book a class in another group right now (null = can),
// before any particular class is chosen. Needs a live abonement with a class
// left (time-based ones always have room). Class packs can't be overbooked:
// open future bookings must stay below the classes left on all live packs
// together — unless a time-based abonement is live, which pays for any number.
// Which abonement covers which class is checked per class (dropInClassBlock).
export const dropInBlockReason = (p: {
    featureOn: boolean // guestVisitsEnabled && scheduleEnabled
    member: { status: string } | null // null = owner / no member row
    subscriptionRequired: boolean // workspace.subscriptionEnabled
    abonements: readonly DropInAbonement[]
    openBookings: number // future, not-yet-marked bookings in this club
    now: Date
}): DropInBlockReason | null => {
    if (!p.featureOn) return 'feature_off'
    if (!p.member) return 'not_member'
    if (p.member.status !== 'ACTIVE') return 'inactive'
    if (p.subscriptionRequired) {
        const live = p.abonements.filter((a) => isSubscriptionUsable(a, p.now))
        if (live.length === 0) return 'no_subscription'
        if (!live.some((a) => a.classesRemaining === null)) {
            const left = live.reduce(
                (sum, a) => sum + Math.max(0, a.classesRemaining ?? 0),
                0,
            )
            if (left <= 0) return 'no_classes'
            if (p.openBookings >= left) return 'classes_allocated'
        }
    }
    if (p.openBookings >= MAX_OPEN_DROP_INS) return 'too_many_bookings'
    return null
}

export type DropInClassBlock =
    | { kind: 'not_covered' }
    | { kind: 'ends_before' }
    | { kind: 'frozen'; until: Date }
    | { kind: 'no_classes' }
    | { kind: 'classes_allocated' }

// Per class: booking a class of another group needs ANY live abonement that
// could pay for it — its scope covers the class's direction, it runs at the
// class start (started by then, not ended before), it is not frozen on the
// class's club day, and it has a class left (or is time-based). The refusal
// names the first condition no abonement passes, so one abonement reads
// exactly as before. Balance, kept simple: with only class packs able to pay,
// the open bookings of classes those packs cover must stay below their classes
// left together.
export const dropInClassBlock = (p: {
    // Live (current) abonements; `frozenUntil` = the freeze covering the class
    // day, null when not frozen.
    abonements: ReadonlyArray<DropInAbonement & { frozenUntil: Date | null }>
    classDirectionId: string | null
    startAt: Date
    // Directions of the classes of the member's other open bookings.
    openBookingDirections: ReadonlyArray<string | null>
}): DropInClassBlock | null => {
    const covering = p.abonements.filter((a) =>
        scopeCoversDirection(a.directionIds, p.classDirectionId),
    )
    if (covering.length === 0) return { kind: 'not_covered' }
    const at = p.startAt.getTime()
    const running = covering.filter(
        (a) =>
            (!a.startDate || a.startDate.getTime() <= at) &&
            (!a.endDate || a.endDate.getTime() >= at),
    )
    if (running.length === 0) return { kind: 'ends_before' }
    const unfrozen = running.filter((a) => !a.frozenUntil)
    if (unfrozen.length === 0) {
        const until = Math.max(...running.map((a) => a.frozenUntil!.getTime()))
        return { kind: 'frozen', until: new Date(until) }
    }
    const payers = unfrozen.filter(
        (a) => a.classesRemaining === null || a.classesRemaining > 0,
    )
    if (payers.length === 0) return { kind: 'no_classes' }
    if (payers.some((a) => a.classesRemaining === null)) return null
    const left = payers.reduce((sum, a) => sum + (a.classesRemaining ?? 0), 0)
    const held = p.openBookingDirections.filter((d) =>
        payers.some((a) => scopeCoversDirection(a.directionIds, d)),
    ).length
    return held >= left ? { kind: 'classes_allocated' } : null
}
