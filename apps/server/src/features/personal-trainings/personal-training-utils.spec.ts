import {
    checkAccept,
    checkCancel,
    checkDecline,
    checkPropose,
    displayStatus,
    latestCoachOption,
    noticeRecipients,
    pluralRu,
    validateProposedTimes,
} from './personal-training-utils'

const NOW = new Date('2026-10-24T09:00:00Z')
const at = (offsetH: number) => new Date(NOW.getTime() + offsetH * 3_600_000)

const opt = (
    id: string,
    proposedBy: 'member' | 'coach',
    startOffsetH: number,
    createdOffsetH = 0,
) => ({
    id,
    startAt: at(startOffsetH),
    durationMin: 60,
    proposedBy,
    createdAt: at(-10 + createdOffsetH),
})

describe('validateProposedTimes', () => {
    it('accepts distinct future times within 90 days', () => {
        expect(validateProposedTimes([at(1), at(48)], NOW)).toBeNull()
    })
    it('rejects a time that is not in the future', () => {
        expect(validateProposedTimes([at(0)], NOW)).toBe(
            'Время тренировки должно быть в будущем',
        )
        expect(validateProposedTimes([at(2), at(-1)], NOW)).toBe(
            'Время тренировки должно быть в будущем',
        )
    })
    it('rejects a time beyond 90 days, allows exactly 90', () => {
        expect(validateProposedTimes([at(90 * 24)], NOW)).toBeNull()
        expect(validateProposedTimes([at(90 * 24 + 1)], NOW)).toBe(
            'Можно предложить время не дальше чем на 90 дней вперёд',
        )
    })
    it('rejects duplicate instants', () => {
        expect(validateProposedTimes([at(5), at(5)], NOW)).toBe(
            'Варианты времени не должны совпадать',
        )
    })
})

describe('latestCoachOption', () => {
    it('returns the newest coach option, ignoring member options', () => {
        const options = [
            opt('m1', 'member', 5, 9),
            opt('c1', 'coach', 6, 1),
            opt('c2', 'coach', 7, 2),
        ]
        expect(latestCoachOption(options)?.id).toBe('c2')
    })
    it('returns null without coach options', () => {
        expect(latestCoachOption([opt('m1', 'member', 5)])).toBeNull()
    })
})

describe('displayStatus', () => {
    const base = {
        confirmedStartAt: null,
        confirmedDurationMin: null,
        options: [] as ReturnType<typeof opt>[],
    }
    it('derives COMPLETED once a confirmed session has ended', () => {
        const r = {
            ...base,
            status: 'CONFIRMED' as const,
            confirmedStartAt: at(-2),
            confirmedDurationMin: 60,
        }
        expect(displayStatus(r, NOW)).toBe('COMPLETED')
        expect(
            displayStatus({ ...r, confirmedStartAt: at(-0.5) }, NOW),
        ).toBe('CONFIRMED')
    })
    it('derives EXPIRED when every member option has passed', () => {
        const options = [opt('m1', 'member', -3), opt('m2', 'member', -1)]
        expect(
            displayStatus({ ...base, status: 'PENDING_COACH', options }, NOW),
        ).toBe('EXPIRED')
        expect(
            displayStatus(
                {
                    ...base,
                    status: 'PENDING_COACH',
                    options: [...options, opt('m3', 'member', 4)],
                },
                NOW,
            ),
        ).toBe('PENDING_COACH')
    })
    it('derives EXPIRED when the latest coach option has passed', () => {
        const options = [
            opt('m1', 'member', 5, 0),
            opt('c1', 'coach', 3, 1),
            opt('c2', 'coach', -1, 2),
        ]
        expect(
            displayStatus({ ...base, status: 'PENDING_MEMBER', options }, NOW),
        ).toBe('EXPIRED')
        expect(
            displayStatus(
                {
                    ...base,
                    status: 'PENDING_MEMBER',
                    options: [opt('c1', 'coach', -1, 1), opt('c2', 'coach', 3, 2)],
                },
                NOW,
            ),
        ).toBe('PENDING_MEMBER')
    })
    it('passes closed statuses through', () => {
        expect(displayStatus({ ...base, status: 'DECLINED' }, NOW)).toBe(
            'DECLINED',
        )
        expect(displayStatus({ ...base, status: 'CANCELLED' }, NOW)).toBe(
            'CANCELLED',
        )
    })
})

describe('checkAccept', () => {
    const member1 = opt('m1', 'member', 5)
    const coach1 = opt('c1', 'coach', 5, 1)
    const coach2 = opt('c2', 'coach', 6, 2)
    const options = [member1, coach1, coach2]
    const run = (over: Record<string, unknown>) =>
        checkAccept({
            actor: 'coach',
            status: 'PENDING_COACH',
            option: member1,
            options,
            now: NOW,
            ...over,
        } as never)

    it('lets the coach pick a member option on a PENDING_COACH request', () => {
        expect(run({})).toBeNull()
    })
    it('lets the member pick the latest coach option on PENDING_MEMBER', () => {
        expect(
            run({ actor: 'member', status: 'PENDING_MEMBER', option: coach2 }),
        ).toBeNull()
    })
    it('refuses closed and confirmed requests', () => {
        expect(run({ status: 'DECLINED' })).toEqual({
            kind: 'conflict',
            message: 'Заявка уже закрыта',
        })
        expect(run({ status: 'CANCELLED' })?.kind).toBe('conflict')
        expect(run({ status: 'CONFIRMED' })).toEqual({
            kind: 'conflict',
            message: 'Тренировка уже подтверждена',
        })
    })
    it('refuses the wrong turn', () => {
        expect(run({ status: 'PENDING_MEMBER' })).toEqual({
            kind: 'conflict',
            message: 'Ждём ответа ученика на ваше предложение',
        })
        expect(run({ actor: 'member', status: 'PENDING_COACH' })).toEqual({
            kind: 'conflict',
            message: 'Заявка ещё у тренера',
        })
    })
    it('refuses a coach picking a coach option', () => {
        expect(run({ option: coach1 })).toEqual({
            kind: 'bad',
            message: 'Выберите один из вариантов ученика',
        })
    })
    it('refuses a member picking a stale coach option', () => {
        expect(
            run({ actor: 'member', status: 'PENDING_MEMBER', option: coach1 }),
        ).toEqual({
            kind: 'conflict',
            message: 'Тренер уже предложил другое время — обновите заявку',
        })
    })
    it('refuses an option in the past', () => {
        expect(run({ option: opt('m9', 'member', -1) })).toEqual({
            kind: 'bad',
            message: 'Это время уже прошло — предложите другое',
        })
    })
})

describe('checkPropose', () => {
    it('lets the coach propose on either pending status', () => {
        expect(checkPropose({ actor: 'coach', status: 'PENDING_COACH' })).toBeNull()
        expect(checkPropose({ actor: 'coach', status: 'PENDING_MEMBER' })).toBeNull()
    })
    it('forbids the member', () => {
        expect(checkPropose({ actor: 'member', status: 'PENDING_COACH' })).toEqual({
            kind: 'forbidden',
            message: 'Предложить время может только тренер',
        })
    })
    it('refuses confirmed and closed requests', () => {
        for (const status of ['CONFIRMED', 'DECLINED', 'CANCELLED'] as const) {
            expect(checkPropose({ actor: 'coach', status })).toEqual({
                kind: 'conflict',
                message: 'Заявка уже закрыта',
            })
        }
    })
})

describe('checkDecline', () => {
    it('lets the coach decline PENDING_COACH and the member PENDING_MEMBER', () => {
        expect(checkDecline({ actor: 'coach', status: 'PENDING_COACH' })).toBeNull()
        expect(checkDecline({ actor: 'member', status: 'PENDING_MEMBER' })).toBeNull()
    })
    it('refuses a member declining their own request', () => {
        expect(checkDecline({ actor: 'member', status: 'PENDING_COACH' })).toEqual({
            kind: 'bad',
            message: 'Свою заявку можно отменить, а не отклонить',
        })
    })
    it('refuses a coach declining their own proposal', () => {
        expect(checkDecline({ actor: 'coach', status: 'PENDING_MEMBER' })).toEqual({
            kind: 'bad',
            message: 'Чтобы отозвать предложение, отмените заявку',
        })
    })
    it('refuses closed and confirmed requests', () => {
        expect(checkDecline({ actor: 'coach', status: 'DECLINED' })?.kind).toBe('conflict')
        expect(checkDecline({ actor: 'coach', status: 'CONFIRMED' })?.kind).toBe('conflict')
    })
})

describe('checkCancel', () => {
    const run = (over: Record<string, unknown>) =>
        checkCancel({
            status: 'CONFIRMED',
            confirmedStartAt: at(5),
            hasRecords: false,
            now: NOW,
            ...over,
        } as never)

    it('allows cancelling any pending request and an upcoming confirmed one', () => {
        expect(run({ status: 'PENDING_COACH', confirmedStartAt: null })).toBeNull()
        expect(run({ status: 'PENDING_MEMBER', confirmedStartAt: null })).toBeNull()
        expect(run({})).toBeNull()
    })
    it('refuses a closed request', () => {
        expect(run({ status: 'DECLINED' })).toEqual({
            kind: 'conflict',
            message: 'Заявка уже закрыта',
        })
        expect(run({ status: 'CANCELLED' })?.kind).toBe('conflict')
    })
    it('refuses a confirmed session that already started', () => {
        expect(run({ confirmedStartAt: at(-1) })).toEqual({
            kind: 'bad',
            message: 'Тренировка уже началась — отменить нельзя',
        })
    })
    it('refuses once attendance was marked', () => {
        expect(run({ hasRecords: true })).toEqual({
            kind: 'bad',
            message: 'Посещение уже отмечено — отменить нельзя',
        })
    })
})

describe('noticeRecipients', () => {
    it('notifies the counterpart of the invoker', () => {
        expect(noticeRecipients('m', 'c', 'm')).toEqual(['c'])
        expect(noticeRecipients('m', 'c', 'c')).toEqual(['m'])
    })
    it('notifies both when an admin acts on the coach\'s behalf', () => {
        expect(noticeRecipients('m', 'c', 'admin')).toEqual(['m', 'c'])
    })
})

describe('pluralRu', () => {
    it('picks the right form', () => {
        expect(pluralRu(1, 'вариант', 'варианта', 'вариантов')).toBe('вариант')
        expect(pluralRu(2, 'вариант', 'варианта', 'вариантов')).toBe('варианта')
        expect(pluralRu(5, 'вариант', 'варианта', 'вариантов')).toBe('вариантов')
        expect(pluralRu(11, 'вариант', 'варианта', 'вариантов')).toBe('вариантов')
    })
})
