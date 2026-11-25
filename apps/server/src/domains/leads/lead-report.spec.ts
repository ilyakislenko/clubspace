import { type LeadReportRow, loadLeadConversion, median, summarizeLeadConversion } from './lead-report'

const T0 = new Date('2026-11-01T10:00:00Z')
const h = (hours: number) => new Date(T0.getTime() + hours * 60 * 60_000)

const row = (o: Partial<LeadReportRow>): LeadReportRow => ({
    source: 'PUBLIC_PAGE',
    status: 'NEW',
    createdAt: T0,
    contactedAt: null,
    trialBookedAt: null,
    cameAt: null,
    lostReason: null,
    convertedUserId: null,
    ...o,
})

describe('lead conversion report', () => {
    it('counts the stages each lead reached, jumps and losses included', () => {
        const rows = [
            row({}),
            row({ status: 'CONTACTED', contactedAt: h(2) }),
            // Jumped NEW → TRIAL_BOOKED: it reached «Связались» too.
            row({ status: 'TRIAL_BOOKED', trialBookedAt: h(1) }),
            row({ status: 'CAME', contactedAt: h(4), trialBookedAt: h(5), cameAt: h(30) }),
            // Lost after the trial: keeps the stages it reached.
            row({ status: 'LOST', contactedAt: h(6), trialBookedAt: h(7), lostReason: 'PRICE' }),
            row({ status: 'LOST', lostReason: 'NO_ANSWER', source: 'QR' }),
            // Linked and bought.
            row({ status: 'CAME', source: 'MANUAL', contactedAt: h(1), convertedUserId: 'u1' }),
            // Linked, no abonement yet.
            row({ status: 'CAME', source: 'MANUAL', convertedUserId: 'u2' }),
        ]
        const report = summarizeLeadConversion(rows, new Set(['u1']))

        expect(report.total).toEqual({
            received: 8,
            contacted: 6,
            trialBooked: 5,
            came: 3,
            bought: 1,
            lostByReason: [
                { reason: 'NO_ANSWER', count: 1 },
                { reason: 'PRICE', count: 1 },
            ],
            medianContactHours: 3,
        })
        expect(report.bySource.map((s) => [s.source, s.received, s.bought])).toEqual([
            ['PUBLIC_PAGE', 5, 0],
            ['QR', 1, 0],
            ['MANUAL', 2, 1],
        ])
    })

    it('leaves spam out of every count', () => {
        const report = summarizeLeadConversion(
            [row({}), row({ status: 'LOST', lostReason: 'SPAM' })],
            new Set(),
        )
        expect(report.total.received).toBe(1)
        expect(report.total.lostByReason).toEqual([])
    })

    it('takes the median of an even and an odd set; null when empty', () => {
        expect(median([])).toBeNull()
        expect(median([5, 1, 3])).toBe(3)
        expect(median([1, 2, 3, 10])).toBe(2.5)
    })

    it('loads the cohort without spam and asks who bought among the linked only', async () => {
        const prisma = {
            lead: {
                findMany: jest.fn().mockResolvedValue([
                    row({ convertedUserId: 'u1', status: 'CAME' }),
                    row({}),
                ]),
            },
            subscription: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }]) },
        }
        const from = new Date('2026-11-01T00:00:00Z')
        const to = new Date('2026-11-30T23:59:59Z')
        const report = await loadLeadConversion(prisma as never, { workspaceId: 'w1', from, to })

        expect(prisma.lead.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            createdAt: { gte: from, lte: to },
            OR: [{ lostReason: null }, { lostReason: { not: 'SPAM' } }],
        })
        expect(prisma.subscription.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: 'w1',
            userId: { in: ['u1'] },
            plan: { isFreeTrial: false },
        })
        expect(report.total.bought).toBe(1)
    })
})
