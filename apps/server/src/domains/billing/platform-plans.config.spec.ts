import {
    addDays,
    BYTES_PER_GB,
    DEFAULT_PLATFORM_PLANS,
    limitFor,
    nextBillingTransition,
    remainingCapacity,
    resolvePlatformPlans,
    suspensionReason,
} from './platform-plans.config'

const usage = { members: 10, coaches: 2, storageBytes: 3 * BYTES_PER_GB, videos: 4 }

describe('resolvePlatformPlans', () => {
    it('returns the Free/Club/Pro defaults when unset or blank', () => {
        expect(resolvePlatformPlans(undefined).map((p) => p.code)).toEqual([
            'free',
            'club',
            'pro',
        ])
        expect(resolvePlatformPlans('  ')).toEqual(DEFAULT_PLATFORM_PLANS)
    })

    it('does not mutate the defaults it starts from', () => {
        resolvePlatformPlans('[{"code":"free","maxMembers":5,"features":["x"]}]')
        expect(DEFAULT_PLATFORM_PLANS[0].maxMembers).toBe(30)
        expect(DEFAULT_PLATFORM_PLANS[0].features).not.toEqual(['x'])
    })

    it('overrides only the named fields of a known plan', () => {
        const plans = resolvePlatformPlans(
            JSON.stringify([
                {
                    code: 'free',
                    maxMembers: 50,
                    maxVideos: null,
                    priceMonthly: 100,
                    currency: 'USD',
                    name: ' Старт ',
                    features: ['a'],
                    sortOrder: 9,
                },
            ]),
        )
        const free = plans.find((p) => p.code === 'free')
        expect(free).toMatchObject({
            name: 'Старт',
            maxMembers: 50,
            maxVideos: null,
            maxCoaches: 2,
            priceMonthly: 100,
            currency: 'USD',
            features: ['a'],
            sortOrder: 9,
        })
    })

    it('adds an unknown plan with unlimited defaults', () => {
        const plans = resolvePlatformPlans('[{"code":"network","name":"Сеть"}]')
        expect(plans.find((p) => p.code === 'network')).toEqual({
            code: 'network',
            name: 'Сеть',
            priceMonthly: 0,
            currency: 'RUB',
            maxMembers: null,
            maxCoaches: null,
            maxStorageGb: null,
            maxVideos: null,
            features: [],
            sortOrder: 3,
        })
    })

    it.each([
        ['not json', 'PLATFORM_PLANS must be a JSON array'],
        ['{}', 'PLATFORM_PLANS must be a JSON array'],
        ['[1]', 'entries must be objects'],
        ['[{"name":"x"}]', 'needs a "code"'],
        ['[{"code":"new"}]', 'needs a "name"'],
        ['[{"code":"free","maxMembers":-1}]', 'non-negative integer'],
        ['[{"code":"free","maxMembers":1.5}]', 'non-negative integer'],
        ['[{"code":"free","priceMonthly":null}]', 'must be a number'],
        ['[{"code":"free","sortOrder":null}]', 'must be a number'],
        ['[{"code":"free","currency":"rub"}]', 'ISO 4217'],
        ['[{"code":"free","name":""}]', 'must be a string'],
        ['[{"code":"free","features":[1]}]', 'string array'],
    ])('rejects %s', (raw, message) => {
        expect(() => resolvePlatformPlans(raw)).toThrow(message)
    })
})

describe('limits', () => {
    const plan = { maxMembers: 30, maxCoaches: null, maxStorageGb: 5, maxVideos: 4 }

    it('reports each dimension in its own unit, storage in bytes', () => {
        expect(limitFor(plan, usage, 'members')).toEqual({ max: 30, used: 10 })
        expect(limitFor(plan, usage, 'coaches')).toEqual({ max: null, used: 2 })
        expect(limitFor(plan, usage, 'videos')).toEqual({ max: 4, used: 4 })
        expect(limitFor(plan, usage, 'storage')).toEqual({
            max: 5 * BYTES_PER_GB,
            used: 3 * BYTES_PER_GB,
        })
        expect(
            limitFor({ ...plan, maxStorageGb: null }, usage, 'storage').max,
        ).toBeNull()
    })

    it('remaining is null when unlimited and never negative', () => {
        expect(remainingCapacity(plan, usage, 'members')).toBe(20)
        expect(remainingCapacity(plan, usage, 'coaches')).toBeNull()
        expect(remainingCapacity(plan, usage, 'videos')).toBe(0)
        expect(
            remainingCapacity({ ...plan, maxMembers: 5 }, usage, 'members'),
        ).toBe(0)
    })
})

describe('nextBillingTransition', () => {
    const now = new Date('2026-11-10T12:00:00.000Z')
    const base = {
        status: 'ACTIVE' as const,
        trialEndsAt: null,
        currentPeriodEnd: null,
        pastDueSince: null,
        priceMonthly: 490_000,
    }

    it('moves an ended trial to PAST_DUE dated from the trial end', () => {
        const trialEndsAt = new Date('2026-11-09T00:00:00.000Z')
        expect(
            nextBillingTransition({ ...base, status: 'TRIAL', trialEndsAt }, now, 7),
        ).toEqual({ status: 'PAST_DUE', pastDueSince: trialEndsAt })
    })

    it('leaves a running trial alone', () => {
        expect(
            nextBillingTransition(
                { ...base, status: 'TRIAL', trialEndsAt: addDays(now, 1) },
                now,
                7,
            ),
        ).toBeNull()
    })

    it('moves an unpaid period on a paid plan to PAST_DUE', () => {
        const currentPeriodEnd = addDays(now, -1)
        expect(
            nextBillingTransition({ ...base, currentPeriodEnd }, now, 7),
        ).toEqual({ status: 'PAST_DUE', pastDueSince: currentPeriodEnd })
    })

    it('never expires a free plan or an open-ended ACTIVE club', () => {
        expect(
            nextBillingTransition(
                { ...base, priceMonthly: 0, currentPeriodEnd: addDays(now, -1) },
                now,
                7,
            ),
        ).toBeNull()
        expect(nextBillingTransition(base, now, 7)).toBeNull()
        expect(
            nextBillingTransition(
                { ...base, currentPeriodEnd: addDays(now, 3) },
                now,
                7,
            ),
        ).toBeNull()
    })

    it('suspends PAST_DUE once the grace days have passed, not before', () => {
        const pastDue = { ...base, status: 'PAST_DUE' as const }
        expect(
            nextBillingTransition(
                { ...pastDue, pastDueSince: addDays(now, -7) },
                now,
                7,
            ),
        ).toEqual({ status: 'SUSPENDED' })
        expect(
            nextBillingTransition(
                { ...pastDue, pastDueSince: addDays(now, -6) },
                now,
                7,
            ),
        ).toBeNull()
        expect(nextBillingTransition(pastDue, now, 7)).toBeNull()
    })

    it('leaves SUSPENDED to the operator', () => {
        expect(
            nextBillingTransition({ ...base, status: 'SUSPENDED' }, now, 7),
        ).toBeNull()
    })
})

describe('suspensionReason', () => {
    it('a switched-off club is closed whatever billing says', () => {
        expect(suspensionReason({ isActive: false, billing: null }, false)).toBe(
            'INACTIVE',
        )
    })

    it('a billing suspension applies only while billing is enabled', () => {
        const ws = { isActive: true, billing: { status: 'SUSPENDED' as const } }
        expect(suspensionReason(ws, true)).toBe('SUSPENDED')
        expect(suspensionReason(ws, false)).toBeNull()
    })

    it('open otherwise', () => {
        expect(
            suspensionReason(
                { isActive: true, billing: { status: 'PAST_DUE' } },
                true,
            ),
        ).toBeNull()
        expect(suspensionReason({ isActive: true, billing: null }, true)).toBeNull()
    })
})
