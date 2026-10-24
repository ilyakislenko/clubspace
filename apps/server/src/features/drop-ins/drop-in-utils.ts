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

// Why this member can't book a class in another group right now (null = can).
// Booking needs a live pack with a class left; time-only packs (no class
// balance) pass. A class pack also can't be overbooked: open future bookings
// must stay below the classes left. Deliberately does not read the pack's
// startDate; whether the pack outlives a given class is checked per class.
export const dropInBlockReason = (p: {
    featureOn: boolean // guestVisitsEnabled && scheduleEnabled
    member: { status: string } | null // null = owner / no member row
    subscriptionRequired: boolean // workspace.subscriptionEnabled
    subscription: {
        status: string
        endDate: Date | null
        classesRemaining: number | null
    } | null
    openBookings: number // future, not-yet-marked bookings in this club
    now: Date
}): DropInBlockReason | null => {
    if (!p.featureOn) return 'feature_off'
    if (!p.member) return 'not_member'
    if (p.member.status !== 'ACTIVE') return 'inactive'
    if (p.subscriptionRequired) {
        if (!isSubscriptionUsable(p.subscription, p.now)) {
            return 'no_subscription'
        }
        if (
            p.subscription?.classesRemaining != null &&
            p.subscription.classesRemaining <= 0
        ) {
            return 'no_classes'
        }
        if (
            p.subscription?.classesRemaining != null &&
            p.openBookings >= p.subscription.classesRemaining
        ) {
            return 'classes_allocated'
        }
    }
    if (p.openBookings >= MAX_OPEN_DROP_INS) return 'too_many_bookings'
    return null
}

// Per class: the pack must still be running when the class starts.
export const subscriptionEndsBeforeClass = (p: {
    subscriptionRequired: boolean
    subscription: { endDate: Date | null } | null
    startAt: Date
}): boolean =>
    p.subscriptionRequired &&
    !!p.subscription?.endDate &&
    p.subscription.endDate.getTime() < p.startAt.getTime()
