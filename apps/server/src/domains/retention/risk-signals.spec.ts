import {
    describeRisk,
    evaluateMemberRisk,
    isSnoozed,
    type MemberRisk,
    type MemberRiskInput,
    type RiskReason,
    summarizeRisk,
} from './risk-signals'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-25T12:00:00Z')
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY)
const TZ = 'Asia/Tomsk'

const liveSub = {
    status: 'ACTIVE',
    endDate: new Date(NOW.getTime() + 20 * DAY),
    classesRemaining: null,
    planName: 'Безлимит',
}

// A healthy regular: visited yesterday, live abonement.
const base = (over: Partial<MemberRiskInput> = {}): MemberRiskInput => ({
    now: NOW,
    tz: TZ,
    attendanceActive: true,
    firstVisitAt: daysAgo(200),
    lastVisitAt: daysAgo(1),
    windowVisits: [daysAgo(1), daysAgo(3), daysAgo(5)],
    frozenNow: false,
    lastFreezeEndAt: null,
    subscription: liveSub,
    accessUntil: null,
    ...over,
})

const signalsOf = (i: MemberRiskInput) => evaluateMemberRisk(i)?.signals ?? []

// n visits spread across [fromDay, toDay] days ago.
const visitsBetween = (n: number, fromDay: number, toDay: number): Date[] =>
    Array.from({ length: n }, (_, k) =>
        daysAgo(fromDay + Math.floor(((toDay - fromDay) * k) / Math.max(n - 1, 1))),
    )

describe('evaluateMemberRisk', () => {
    it('returns null for a healthy regular', () => {
        expect(evaluateMemberRisk(base())).toBeNull()
    })

    it('returns null for a frozen member whatever else is true', () => {
        expect(
            evaluateMemberRisk(
                base({
                    frozenNow: true,
                    lastVisitAt: daysAgo(40),
                    subscription: null,
                }),
            ),
        ).toBeNull()
    })

    describe('absent', () => {
        it('does not fire at 13 days, fires at 14', () => {
            expect(signalsOf(base({ lastVisitAt: daysAgo(13) }))).toEqual([])
            expect(signalsOf(base({ lastVisitAt: daysAgo(14) }))).toEqual(['absent'])
        })

        it('is capped at 90 days without a live abonement', () => {
            const noSub = { subscription: null }
            expect(signalsOf(base({ ...noSub, lastVisitAt: daysAgo(90) }))).toEqual(['absent'])
            expect(signalsOf(base({ ...noSub, lastVisitAt: daysAgo(91) }))).toEqual([])
        })

        it('ignores the 90-day cap while an abonement is live', () => {
            expect(signalsOf(base({ lastVisitAt: daysAgo(120) }))).toEqual(['absent'])
        })

        it('does not flag a member who never visited', () => {
            expect(
                signalsOf(base({ firstVisitAt: null, lastVisitAt: null, windowVisits: [] })),
            ).toEqual([])
        })

        it('counts from the end of a finished freeze', () => {
            const i = base({ lastVisitAt: daysAgo(40), lastFreezeEndAt: daysAgo(5) })
            expect(signalsOf(i)).toEqual([])
            const j = base({ lastVisitAt: daysAgo(40), lastFreezeEndAt: daysAgo(14) })
            const risk = evaluateMemberRisk(j)!
            expect(risk.signals).toEqual(['absent'])
            expect(risk.facts.absentSinceFreeze).toBe(true)
        })
    })

    describe('club-local calendar days', () => {
        // 08:00 on 25 Oct in Tomsk.
        const morning = new Date('2026-10-25T01:00:00Z')

        it('counts a visit yesterday 20:00 seen today 08:00 as yesterday', () => {
            const risk = evaluateMemberRisk(
                base({
                    now: morning,
                    lastVisitAt: new Date('2026-10-24T13:00:00Z'),
                    subscription: {
                        ...liveSub,
                        status: 'EXPIRED',
                        endDate: new Date('2026-10-20T00:00:00Z'),
                    },
                }),
            )!
            expect(risk.facts.daysSinceLastVisit).toBe(1)
            expect(describeRisk(risk, TZ)).toContain('последний визит вчера')
        })

        it('fires absent on the 14th local day even when 14 x 24h have not passed', () => {
            // 11 Oct 20:00 local -> 25 Oct 08:00 local is 13.5 days elapsed.
            const lastVisitAt = new Date('2026-10-11T13:00:00Z')
            expect(signalsOf(base({ now: morning, lastVisitAt }))).toEqual(['absent'])
            const dayLater = new Date('2026-10-12T13:00:00Z')
            expect(signalsOf(base({ now: morning, lastVisitAt: dayLater }))).toEqual([])
        })
    })

    describe('newcomer', () => {
        const newcomer = (over: Partial<MemberRiskInput> = {}) =>
            base({
                firstVisitAt: daysAgo(30),
                lastVisitAt: daysAgo(10),
                windowVisits: [daysAgo(10), daysAgo(30)],
                ...over,
            })

        it('fires for a 30-day-old member with no visit in 14 days', () => {
            expect(signalsOf(newcomer())).toEqual(['newcomer'])
        })

        it('does not fire when the first visit was 13 days ago', () => {
            expect(
                signalsOf(newcomer({ firstVisitAt: daysAgo(13), windowVisits: [daysAgo(13)] })),
            ).toEqual([])
        })

        it('fires at 14 days of tenure and 90, not at 91', () => {
            expect(signalsOf(newcomer({ firstVisitAt: daysAgo(14) }))).toContain('newcomer')
            expect(signalsOf(newcomer({ firstVisitAt: daysAgo(90) }))).toContain('newcomer')
            expect(signalsOf(newcomer({ firstVisitAt: daysAgo(91) }))).not.toContain('newcomer')
        })

        it('does not fire with 2 visits in the last 14 days', () => {
            expect(
                signalsOf(
                    newcomer({
                        lastVisitAt: daysAgo(1),
                        windowVisits: [daysAgo(1), daysAgo(8), daysAgo(30)],
                    }),
                ),
            ).toEqual([])
        })

        it('is held off by a recent freeze', () => {
            expect(signalsOf(newcomer({ lastFreezeEndAt: daysAgo(5) }))).not.toContain('newcomer')
        })
    })

    describe('declining', () => {
        // baseline = visits older than 28 days; recent = last 28 days.
        const declining = (recent: number, baseline: number, over: Partial<MemberRiskInput> = {}) =>
            base({
                lastVisitAt: daysAgo(1),
                windowVisits: [...visitsBetween(recent, 1, 26), ...visitsBetween(baseline, 30, 80)],
                ...over,
            })

        it('fires when recent*4 equals the baseline', () => {
            // 2 recent, 8 baseline: 2*4 === 8
            expect(signalsOf(declining(2, 8))).toEqual(['declining'])
        })

        it('does not fire when recent*4 is above the baseline', () => {
            expect(signalsOf(declining(3, 8))).toEqual([])
        })

        it('needs a baseline of 8 visits (7 is not enough)', () => {
            expect(signalsOf(declining(0, 7, { lastVisitAt: daysAgo(30) }))).not.toContain(
                'declining',
            )
            expect(signalsOf(declining(0, 8, { lastVisitAt: daysAgo(30) }))).toContain('declining')
        })

        it('is skipped when a freeze sits in the window', () => {
            expect(signalsOf(declining(2, 8, { lastFreezeEndAt: daysAgo(60) }))).toEqual([])
        })

        it('reports weekly rates rounded to one decimal', () => {
            const risk = evaluateMemberRisk(declining(2, 12))!
            expect(risk.facts.recentPerWeek).toBe(0.5)
            expect(risk.facts.baselinePerWeek).toBe(1.5)
        })
    })

    describe('lapsed', () => {
        const ended = (days: number) => ({
            ...liveSub,
            status: 'EXPIRED',
            endDate: daysAgo(days),
        })

        it('fires when the abonement ended 29 days ago, not 31', () => {
            const at29 = evaluateMemberRisk(base({ subscription: ended(29) }))!
            expect(at29.signals).toContain('lapsed')
            expect(at29.facts.lapseKind).toBe('expired')
            expect(at29.facts.planName).toBe('Безлимит')
            expect(signalsOf(base({ subscription: ended(31) }))).toEqual([])
        })

        it('also fires on an ACTIVE row whose endDate passed', () => {
            expect(
                signalsOf(base({ subscription: { ...liveSub, endDate: daysAgo(3) } })),
            ).toEqual(['lapsed'])
        })

        it('does not fire for a cancelled abonement', () => {
            expect(
                signalsOf(base({ subscription: { ...ended(5), status: 'CANCELLED' } })),
            ).toEqual([])
        })

        it('does not fire when access was extended by hand', () => {
            expect(
                signalsOf(
                    base({
                        subscription: ended(5),
                        accessUntil: new Date(NOW.getTime() + 5 * DAY),
                    }),
                ),
            ).toEqual([])
        })

        it('fires access_ended when only the access window ran out', () => {
            const risk = evaluateMemberRisk(
                base({ subscription: null, accessUntil: daysAgo(4) }),
            )!
            expect(risk.facts.lapseKind).toBe('access_ended')
            expect(risk.facts.lapsedAt).toEqual(daysAgo(4))
            expect(risk.facts.planName).toBeNull()
        })

        it('fires out_of_classes for a live pack at 0 classes with a recent visit', () => {
            const risk = evaluateMemberRisk(
                base({ subscription: { ...liveSub, endDate: null, classesRemaining: 0 } }),
            )!
            expect(risk.facts.lapseKind).toBe('out_of_classes')
            expect(risk.facts.lapsedAt).toBeNull()
        })

        it('does not fire out_of_classes when the last visit is over 30 days old', () => {
            expect(
                signalsOf(
                    base({
                        lastVisitAt: daysAgo(35),
                        attendanceActive: false,
                        subscription: { ...liveSub, endDate: null, classesRemaining: 0 },
                    }),
                ),
            ).toEqual([])
        })

        it('does not treat a pack with 0 classes left as live for the absent cap', () => {
            const lastVisitAt = daysAgo(120)
            const pack = (classesRemaining: number) =>
                base({
                    lastVisitAt,
                    subscription: { ...liveSub, endDate: null, classesRemaining },
                })
            expect(signalsOf(pack(0))).toEqual([])
            expect(signalsOf(pack(3))).toEqual(['absent'])
        })

        it('does not fire for a pending first-visit abonement (no endDate)', () => {
            expect(
                signalsOf(
                    base({ subscription: { ...liveSub, endDate: null, classesRemaining: 10 } }),
                ),
            ).toEqual([])
        })

        it('still fires when coaches stopped marking attendance', () => {
            expect(
                signalsOf(base({ attendanceActive: false, subscription: ended(5) })),
            ).toEqual(['lapsed'])
        })
    })

    it('raises only lapsed when attendance is not being marked club-wide', () => {
        expect(
            signalsOf(
                base({
                    attendanceActive: false,
                    lastVisitAt: daysAgo(60),
                    subscription: { ...liveSub, endDate: daysAgo(2) },
                }),
            ),
        ).toEqual(['lapsed'])
        expect(signalsOf(base({ attendanceActive: false, lastVisitAt: daysAgo(60) }))).toEqual([])
    })

    it('orders signals by priority and uses the first as the reason', () => {
        const risk = evaluateMemberRisk(
            base({
                firstVisitAt: daysAgo(40),
                lastVisitAt: daysAgo(20),
                windowVisits: [daysAgo(20), daysAgo(40)],
                subscription: { ...liveSub, endDate: daysAgo(2) },
            }),
        )!
        expect(risk.signals).toEqual(['lapsed', 'newcomer', 'absent'])
        expect(risk.reason).toBe('lapsed')
    })
})

describe('describeRisk', () => {
    const risk = (reason: RiskReason, facts: Partial<MemberRisk['facts']> = {}): MemberRisk => ({
        reason,
        signals: [reason],
        facts: {
            lastVisitAt: null,
            daysSinceLastVisit: null,
            firstVisitAt: null,
            daysSinceFirstVisit: null,
            visitsLast14d: 0,
            recentPerWeek: 0,
            baselinePerWeek: 0,
            absentSinceFreeze: false,
            lapseKind: null,
            lapsedAt: null,
            planName: null,
            ...facts,
        },
    })

    it('words an expired abonement with the last visit', () => {
        expect(
            describeRisk(
                risk('lapsed', {
                    lapseKind: 'expired',
                    lapsedAt: new Date('2026-10-08T05:00:00Z'),
                    planName: 'Безлимит',
                    lastVisitAt: daysAgo(3),
                    daysSinceLastVisit: 3,
                }),
                TZ,
            ),
        ).toBe('Абонемент «Безлимит» закончился 8 октября · последний визит 3 дня назад')
    })

    it('words an out-of-classes pack for someone who never came', () => {
        expect(
            describeRisk(
                risk('lapsed', { lapseKind: 'out_of_classes', planName: '8 занятий' }),
                TZ,
            ),
        ).toBe('Закончились занятия в абонементе «8 занятий» · ещё не был ни разу')
    })

    it('words an ended access window', () => {
        expect(
            describeRisk(
                risk('lapsed', {
                    lapseKind: 'access_ended',
                    lapsedAt: new Date('2026-10-08T05:00:00Z'),
                    lastVisitAt: daysAgo(1),
                    daysSinceLastVisit: 1,
                }),
                TZ,
            ),
        ).toBe('Доступ закончился 8 октября · последний визит вчера')
    })

    it('words a newcomer', () => {
        expect(
            describeRisk(risk('newcomer', { daysSinceFirstVisit: 30, visitsLast14d: 1 }), TZ),
        ).toBe('Первый визит 4 недели назад, за 2 недели — 1 визит')
        expect(
            describeRisk(risk('newcomer', { daysSinceFirstVisit: 20, visitsLast14d: 0 }), TZ),
        ).toBe('Первый визит 2 недели назад, за 2 недели — 0 визитов')
    })

    it('words an absence, with and without a freeze', () => {
        expect(describeRisk(risk('absent', { daysSinceLastVisit: 21 }), TZ)).toBe(
            'Последний визит 3 недели назад',
        )
        expect(
            describeRisk(risk('absent', { daysSinceLastVisit: 21, absentSinceFreeze: true }), TZ),
        ).toBe('Последний визит 3 недели назад · после заморозки')
    })

    it('words a decline with a decimal comma', () => {
        expect(
            describeRisk(risk('declining', { baselinePerWeek: 1.5, recentPerWeek: 0.5 }), TZ),
        ).toBe('Было ~1,5/нед, стало 0,5/нед')
        expect(
            describeRisk(risk('declining', { baselinePerWeek: 2, recentPerWeek: 0 }), TZ),
        ).toBe('Было ~2/нед, стало 0/нед')
    })

    it.each([
        [0, 'Последний визит сегодня'],
        [1, 'Последний визит вчера'],
        [13, 'Последний визит 13 дней назад'],
        [14, 'Последний визит 2 недели назад'],
        [59, 'Последний визит 8 недель назад'],
        [60, 'Последний визит 2 месяца назад'],
        [365, 'Последний визит 12 месяцев назад'],
    ])('ago(%i)', (d, text) => {
        expect(describeRisk(risk('absent', { daysSinceLastVisit: d }), TZ)).toBe(text)
    })
})

describe('isSnoozed', () => {
    const risk = (signals: RiskReason[]): MemberRisk =>
        ({ reason: signals[0], signals, facts: {} }) as MemberRisk

    it('is false without a contact', () => {
        expect(isSnoozed(null, risk(['absent']), NOW)).toBe(false)
    })

    it('hides for 13d23h, not at 14d', () => {
        const signals: RiskReason[] = ['absent']
        const at = (ms: number) => ({ at: new Date(NOW.getTime() - ms), signals })
        expect(isSnoozed(at(14 * DAY - 60 * 60 * 1000), risk(['absent']), NOW)).toBe(true)
        expect(isSnoozed(at(14 * DAY), risk(['absent']), NOW)).toBe(false)
    })

    it('stays hidden while the signals are a subset of the logged ones', () => {
        const contact = { at: daysAgo(2), signals: ['absent', 'declining'] as RiskReason[] }
        expect(isSnoozed(contact, risk(['absent']), NOW)).toBe(true)
    })

    it('reappears when a new signal shows up', () => {
        const contact = { at: daysAgo(2), signals: ['absent'] as RiskReason[] }
        expect(isSnoozed(contact, risk(['lapsed', 'absent']), NOW)).toBe(false)
    })

    it('does not un-snooze on «declining» when the contact already knew «absent»', () => {
        const contact = { at: daysAgo(2), signals: ['absent'] as RiskReason[] }
        expect(isSnoozed(contact, risk(['absent', 'declining']), NOW)).toBe(true)
        // Declining alone is not implied by a «lapsed» contact.
        const lapsedOnly = { at: daysAgo(2), signals: ['lapsed'] as RiskReason[] }
        expect(isSnoozed(lapsedOnly, risk(['declining']), NOW)).toBe(false)
    })

    it('treats a contact logged with no signals plus a new signal as not snoozed', () => {
        expect(isSnoozed({ at: daysAgo(1), signals: [] }, risk(['absent']), NOW)).toBe(false)
    })
})

describe('summarizeRisk', () => {
    const entry = (reason: RiskReason, snoozed = false) => ({
        risk: { reason, signals: [reason], facts: {} } as unknown as MemberRisk,
        snoozed,
    })

    it('counts by headline reason and keeps snoozed apart', () => {
        expect(
            summarizeRisk([
                entry('lapsed'),
                entry('absent'),
                entry('absent'),
                entry('declining', true),
                entry('newcomer'),
            ]),
        ).toEqual({ total: 4, lapsed: 1, newcomer: 1, absent: 2, declining: 0, snoozed: 1 })
    })

    it('is all zeros for an empty list', () => {
        expect(summarizeRisk([])).toEqual({
            total: 0,
            lapsed: 0,
            newcomer: 0,
            absent: 0,
            declining: 0,
            snoozed: 0,
        })
    })
})
