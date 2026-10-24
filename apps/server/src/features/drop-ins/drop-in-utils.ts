import { isSubscriptionUsable } from '../../domains/subscriptions/subscription-status'

export type DropInBlockReason =
    | 'feature_off'
    | 'not_member'
    | 'inactive'
    | 'no_subscription'
    | 'no_classes'

export const DROP_IN_BLOCK_MESSAGES: Record<DropInBlockReason, string> = {
    feature_off: 'Гостевые визиты в другие группы отключены в клубе',
    not_member: 'Запись в другие группы доступна участникам клуба',
    inactive: 'Ваше участие в клубе приостановлено — обратитесь к тренеру',
    no_subscription:
        'Чтобы записаться в другую группу, нужен действующий абонемент — оформите его у тренера',
    no_classes: 'На абонементе не осталось занятий — продлите его у тренера',
}

// Forbidden vs bad-request: the first three are about who you are, the last two
// about what you hold.
export const DROP_IN_FORBIDDEN_REASONS: ReadonlySet<DropInBlockReason> =
    new Set(['feature_off', 'not_member', 'inactive'])

// Why this member can't book a class in another group right now (null = can).
// Booking needs a live pack with a class left; time-only packs (no class
// balance) pass. Deliberately does not read the pack's startDate.
export const dropInBlockReason = (p: {
    featureOn: boolean // guestVisitsEnabled && scheduleEnabled
    member: { status: string } | null // null = owner / no member row
    subscriptionRequired: boolean // workspace.subscriptionEnabled
    subscription: {
        status: string
        endDate: Date | null
        classesRemaining: number | null
    } | null
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
    }
    return null
}
