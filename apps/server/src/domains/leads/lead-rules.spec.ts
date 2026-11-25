import {
    anonymizeData,
    boughtSubscriptionWhere,
    boughtUserWhere,
    canMoveLead,
    displayStatus,
    duplicateWhere,
    idleCloseData,
    idleWhere,
    isNeedsAction,
    leadStatusStamp,
    needsActionWhere,
    retentionWhere,
} from './lead-rules'
import { dpaCoversLeads } from './lead-consent'
import { leadCreatedText, leadStaleText, leadTrialBookedText } from './lead-notifications'

const NOW = new Date('2026-12-10T12:00:00Z')
const DAY = 24 * 60 * 60_000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

// Evaluates the where-builders against an in-memory row: the subset of
// Prisma's filter language they use.
type Row = Record<string, unknown>
const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, cond]) => {
        if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w))
        if (key === 'AND') return (cond as Row[]).every((w) => matches(row, w))
        if (key === 'NOT') return !matches(row, cond as Row)
        const value = row[key]
        if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
            return value === cond || (value instanceof Date && +value === +(cond as Date))
        }
        const c = cond as Record<string, unknown>
        if ('not' in c) return value !== c.not
        if ('lt' in c) return value instanceof Date && value < (c.lt as Date)
        if ('gte' in c) return value instanceof Date && value >= (c.gte as Date)
        return false
    })

describe('lead rules', () => {
    describe('canMoveLead', () => {
        it('lets staff jump forward, never back, and reschedule a booked trial', () => {
            expect(canMoveLead('NEW', 'TRIAL_BOOKED')).toBe(true)
            expect(canMoveLead('NEW', 'CAME')).toBe(true)
            expect(canMoveLead('CONTACTED', 'NEW')).toBe(false)
            expect(canMoveLead('CAME', 'TRIAL_BOOKED')).toBe(false)
            expect(canMoveLead('TRIAL_BOOKED', 'TRIAL_BOOKED')).toBe(true)
            expect(canMoveLead('CONTACTED', 'CONTACTED')).toBe(false)
        })

        it('reaches LOST from any open status; back only to CONTACTED', () => {
            for (const from of ['NEW', 'CONTACTED', 'TRIAL_BOOKED', 'CAME'] as const) {
                expect(canMoveLead(from, 'LOST')).toBe(true)
            }
            expect(canMoveLead('LOST', 'CONTACTED')).toBe(true)
            expect(canMoveLead('LOST', 'NEW')).toBe(false)
            expect(canMoveLead('LOST', 'CAME')).toBe(false)
        })
    })

    it('stamps the move; the first contact once; «Вернуть в работу» clears the refusal', () => {
        const first = new Date('2026-12-01T10:00:00Z')
        expect(leadStatusStamp('TRIAL_BOOKED', NOW, { contactedAt: null })).toEqual({
            status: 'TRIAL_BOOKED',
            statusChangedAt: NOW,
            // NEW → TRIAL_BOOKED is a reaction too: it counts as the contact.
            contactedAt: NOW,
            trialBookedAt: NOW,
        })
        expect(leadStatusStamp('CAME', NOW, { contactedAt: first })).toMatchObject({ contactedAt: first, cameAt: NOW })
        // LOST → CONTACTED keeps the original contact.
        expect(leadStatusStamp('CONTACTED', NOW, { contactedAt: first })).toEqual({
            status: 'CONTACTED',
            statusChangedAt: NOW,
            contactedAt: first,
            lostAt: null,
            lostReason: null,
            lostComment: null,
        })
        expect(leadStatusStamp('LOST', NOW, { contactedAt: null })).toEqual({
            status: 'LOST',
            statusChangedAt: NOW,
            lostAt: NOW,
        })
    })

    describe('«Купил»', () => {
        it('needs a paid, non-free-trial abonement with money of this club', () => {
            expect(boughtSubscriptionWhere('w1')).toEqual({
                workspaceId: 'w1',
                isPaid: true,
                amountPaid: { gt: 0 },
                plan: { isFreeTrial: false },
            })
            expect(boughtUserWhere('w1')).toEqual({
                convertedUser: {
                    is: { subscriptions: { some: boughtSubscriptionWhere('w1') } },
                },
            })
        })

        it('is shown over the stored status only when it holds', () => {
            expect(displayStatus({ status: 'CAME' }, true)).toBe('BOUGHT')
            expect(displayStatus({ status: 'CAME' }, false)).toBe('CAME')
        })
    })

    describe('needs action', () => {
        const lead = (status: string, trialAt: Date | null) =>
            ({ status, trialAt, anonymizedAt: null }) as Parameters<typeof isNeedsAction>[0]

        it('is a new lead or a trial whose time has passed', () => {
            expect(isNeedsAction(lead('NEW', null), NOW)).toBe(true)
            expect(isNeedsAction(lead('TRIAL_BOOKED', ago(1)), NOW)).toBe(true)
            expect(isNeedsAction(lead('TRIAL_BOOKED', ago(-1)), NOW)).toBe(false)
            expect(isNeedsAction(lead('CONTACTED', null), NOW)).toBe(false)
        })

        it('has the same rule as a where', () => {
            const where = needsActionWhere(NOW)
            expect(matches({ status: 'NEW', anonymizedAt: null }, where)).toBe(true)
            expect(matches({ status: 'TRIAL_BOOKED', trialAt: ago(1), anonymizedAt: null }, where)).toBe(true)
            expect(matches({ status: 'TRIAL_BOOKED', trialAt: ago(-1), anonymizedAt: null }, where)).toBe(false)
            expect(matches({ status: 'NEW', anonymizedAt: NOW }, where)).toBe(false)
        })
    })

    it('treats the same phone as a duplicate for 30 days, while open', () => {
        const where = duplicateWhere({ workspaceId: 'w1', phone: '+79528849420', now: NOW })
        const open = {
            workspaceId: 'w1',
            phone: '+79528849420',
            status: 'NEW',
            convertedUserId: null,
            anonymizedAt: null,
        }
        expect(matches({ ...open, createdAt: ago(29) }, where)).toBe(true)
        expect(matches({ ...open, createdAt: ago(31) }, where)).toBe(false)
        expect(matches({ ...open, createdAt: ago(1), status: 'LOST' }, where)).toBe(false)
        expect(matches({ ...open, createdAt: ago(1), convertedUserId: 'u1' }, where)).toBe(false)
        expect(matches({ ...open, createdAt: ago(1), workspaceId: 'w2' }, where)).toBe(false)
    })

    describe('retention', () => {
        it('anonymises a lost or joined lead after 90 days, not at 89', () => {
            const where = retentionWhere(NOW)
            const lost = { status: 'LOST', anonymizedAt: null, convertedAt: null }
            expect(matches({ ...lost, lostAt: ago(89) }, where)).toBe(false)
            expect(matches({ ...lost, lostAt: ago(91) }, where)).toBe(true)
            const joined = { status: 'CAME', anonymizedAt: null, lostAt: null }
            expect(matches({ ...joined, convertedAt: ago(89) }, where)).toBe(false)
            expect(matches({ ...joined, convertedAt: ago(91) }, where)).toBe(true)
            expect(matches({ ...lost, lostAt: ago(91), anonymizedAt: ago(1) }, where)).toBe(false)
        })

        it('closes an open lead idle for 180 days, not at 179', () => {
            const where = idleWhere(NOW)
            const open = { status: 'CONTACTED', convertedUserId: null, anonymizedAt: null }
            expect(matches({ ...open, statusChangedAt: ago(179) }, where)).toBe(false)
            expect(matches({ ...open, statusChangedAt: ago(181) }, where)).toBe(true)
            expect(idleCloseData(NOW)).toMatchObject({
                status: 'LOST',
                lostReason: 'NO_ANSWER',
                lostAt: NOW,
                anonymizedAt: NOW,
                phone: null,
            })
        })

        it('anonymising keeps the report fields', () => {
            const data = anonymizeData(NOW)
            for (const kept of [
                'source',
                'status',
                'createdAt',
                'contactedAt',
                'trialBookedAt',
                'cameAt',
                'lostReason',
                'directionId',
                'convertedUserId',
            ]) {
                expect(data).not.toHaveProperty(kept)
            }
            expect(data).toMatchObject({ name: null, phone: null, email: null, anonymizedAt: NOW })
        })
    })

    it('enables the public form only from the DPA edition listing lead subjects', () => {
        expect(dpaCoversLeads(null)).toBe(false)
        expect(dpaCoversLeads('2026-11-01')).toBe(false)
        expect(dpaCoversLeads('2026-12-01')).toBe(true)
        expect(dpaCoversLeads('2026-12-01.2')).toBe(true)
        expect(dpaCoversLeads('2027-01-15')).toBe(true)
    })

    it('notification texts carry no personal data of the lead', () => {
        expect(leadCreatedText({ directionName: 'Дети 6–9' })).toEqual({
            topic: 'Новая заявка на пробное',
            message: 'Дети 6–9. Откройте «Ученики → Пробные».',
        })
        expect(leadCreatedText({ directionName: null }).message).toBe(
            'Откройте «Ученики → Пробные».',
        )
        expect(leadStaleText(3).message).toBe('Заявки на пробное ждут ответа больше суток: 3')
        expect(
            leadTrialBookedText({
                trialAt: new Date('2026-11-21T15:00:00Z'),
                timeZone: 'Europe/Moscow',
                groupName: 'Дети 6–9',
            }),
        ).toEqual({
            topic: 'На пробное придёт новый человек',
            message: 'сб, 21 нояб., 18:00 · «Дети 6–9»',
        })
    })
})
