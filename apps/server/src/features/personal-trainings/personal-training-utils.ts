export type PersonalTrainingStatus =
    | 'PENDING_COACH'
    | 'PENDING_MEMBER'
    | 'CONFIRMED'
    | 'DECLINED'
    | 'CANCELLED'

// COMPLETED and EXPIRED are derived from the clock at read time — no cron.
export type DisplayStatus = PersonalTrainingStatus | 'COMPLETED' | 'EXPIRED'

export type PersonalTrainingActor = 'member' | 'coach'

export type PersonalTrainingOptionLike = {
    id: string
    startAt: Date
    durationMin: number
    proposedBy: string
    createdAt: Date
}

const DAY_MS = 24 * 60 * 60 * 1000
const HORIZON_DAYS = 90

// Null when every proposed instant is acceptable, else the RU message.
export const validateProposedTimes = (
    instants: Date[],
    now: Date,
): string | null => {
    if (instants.some((d) => d.getTime() <= now.getTime())) {
        return 'Время тренировки должно быть в будущем'
    }
    const limit = now.getTime() + HORIZON_DAYS * DAY_MS
    if (instants.some((d) => d.getTime() > limit)) {
        return 'Можно предложить время не дальше чем на 90 дней вперёд'
    }
    if (new Set(instants.map((d) => d.getTime())).size !== instants.length) {
        return 'Варианты времени не должны совпадать'
    }
    return null
}

// The newest coach proposal (the one the member is being asked about).
export const latestCoachOption = <T extends PersonalTrainingOptionLike>(
    options: T[],
): T | null => {
    let latest: T | null = null
    for (const o of options) {
        if (o.proposedBy !== 'coach') continue
        if (!latest || o.createdAt.getTime() >= latest.createdAt.getTime()) {
            latest = o
        }
    }
    return latest
}

export const displayStatus = (
    r: {
        status: PersonalTrainingStatus
        confirmedStartAt: Date | null
        confirmedDurationMin: number | null
        options: PersonalTrainingOptionLike[]
    },
    now: Date,
): DisplayStatus => {
    if (r.status === 'CONFIRMED') {
        if (r.confirmedStartAt) {
            const end =
                r.confirmedStartAt.getTime() +
                (r.confirmedDurationMin ?? 0) * 60_000
            if (end <= now.getTime()) return 'COMPLETED'
        }
        return r.status
    }
    if (r.status === 'PENDING_COACH') {
        const mine = r.options.filter((o) => o.proposedBy === 'member')
        if (
            mine.length > 0 &&
            mine.every((o) => o.startAt.getTime() <= now.getTime())
        ) {
            return 'EXPIRED'
        }
        return r.status
    }
    if (r.status === 'PENDING_MEMBER') {
        const latest = latestCoachOption(r.options)
        if (latest && latest.startAt.getTime() <= now.getTime()) {
            return 'EXPIRED'
        }
    }
    return r.status
}

export type Refusal = {
    kind: 'conflict' | 'bad' | 'forbidden'
    message: string
} | null

const isClosed = (status: PersonalTrainingStatus): boolean =>
    status === 'DECLINED' || status === 'CANCELLED'

export const checkAccept = (p: {
    actor: PersonalTrainingActor
    status: PersonalTrainingStatus
    option: PersonalTrainingOptionLike
    options: PersonalTrainingOptionLike[]
    now: Date
}): Refusal => {
    if (isClosed(p.status)) {
        return { kind: 'conflict', message: 'Заявка уже закрыта' }
    }
    if (p.status === 'CONFIRMED') {
        return { kind: 'conflict', message: 'Тренировка уже подтверждена' }
    }
    if (p.actor === 'coach' && p.status === 'PENDING_MEMBER') {
        return {
            kind: 'conflict',
            message: 'Ждём ответа ученика на ваше предложение',
        }
    }
    if (p.actor === 'member' && p.status === 'PENDING_COACH') {
        return { kind: 'conflict', message: 'Заявка ещё у тренера' }
    }
    if (p.actor === 'coach' && p.option.proposedBy !== 'member') {
        return { kind: 'bad', message: 'Выберите один из вариантов ученика' }
    }
    if (p.actor === 'member') {
        const latest = latestCoachOption(p.options)
        if (!latest || latest.id !== p.option.id) {
            return {
                kind: 'conflict',
                message: 'Тренер уже предложил другое время — обновите заявку',
            }
        }
    }
    if (p.option.startAt.getTime() <= p.now.getTime()) {
        return {
            kind: 'bad',
            message: 'Это время уже прошло — предложите другое',
        }
    }
    return null
}

export const checkPropose = (p: {
    actor: PersonalTrainingActor
    status: PersonalTrainingStatus
}): Refusal => {
    if (p.actor === 'member') {
        return {
            kind: 'forbidden',
            message: 'Предложить время может только тренер',
        }
    }
    if (p.status === 'CONFIRMED' || isClosed(p.status)) {
        return { kind: 'conflict', message: 'Заявка уже закрыта' }
    }
    return null
}

export const checkDecline = (p: {
    actor: PersonalTrainingActor
    status: PersonalTrainingStatus
}): Refusal => {
    if (isClosed(p.status)) {
        return { kind: 'conflict', message: 'Заявка уже закрыта' }
    }
    if (p.status === 'CONFIRMED') {
        return { kind: 'conflict', message: 'Тренировка уже подтверждена' }
    }
    if (p.actor === 'member' && p.status === 'PENDING_COACH') {
        return {
            kind: 'bad',
            message: 'Свою заявку можно отменить, а не отклонить',
        }
    }
    if (p.actor === 'coach' && p.status === 'PENDING_MEMBER') {
        return {
            kind: 'bad',
            message: 'Чтобы отозвать предложение, отмените заявку',
        }
    }
    return null
}

export const checkCancel = (p: {
    status: PersonalTrainingStatus
    confirmedStartAt: Date | null
    hasRecords: boolean
    now: Date
}): Refusal => {
    if (isClosed(p.status)) {
        return { kind: 'conflict', message: 'Заявка уже закрыта' }
    }
    if (p.status === 'CONFIRMED') {
        if (
            !p.confirmedStartAt ||
            p.confirmedStartAt.getTime() <= p.now.getTime()
        ) {
            return {
                kind: 'bad',
                message: 'Тренировка уже началась — отменить нельзя',
            }
        }
        if (p.hasRecords) {
            return {
                kind: 'bad',
                message: 'Посещение уже отмечено — отменить нельзя',
            }
        }
    }
    return null
}

// Who hears about a transition: the other participant(s), never the actor.
// An admin acting on the coach's behalf notifies both participants.
export const noticeRecipients = (
    memberId: string,
    coachId: string,
    invokerId: string,
): string[] => [memberId, coachId].filter((id) => id !== invokerId)

// Russian plural form: one → 1, 21; few → 2–4, 22–24; many → 0, 5–20, 25…
export const pluralRu = (
    n: number,
    one: string,
    few: string,
    many: string,
): string => {
    const last = Math.abs(n) % 10
    const last2 = Math.abs(n) % 100
    if (last2 >= 11 && last2 <= 14) return many
    if (last === 1) return one
    if (last >= 2 && last <= 4) return few
    return many
}
