import { createHash } from 'crypto'

import {
    eventOccurrenceKey,
    isoDayOfWeek,
    localDateInTz,
    personalOccurrenceKey,
    scheduledOccurrenceKey,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import { GUARDIAN_CONSENT_VERSION } from '../../features/dependents/dependents-utils'
import { defaultAchievementRows } from '../../features/manage-achievements/default-achievement-rows'
import type { Prisma } from '../../infrastructure/prisma'
import { FIRST_VISIT_AUTO_START_DAYS } from '../subscriptions/first-visit-start'
import { addDaysYmd, diffDaysYmd, ymdToDbDate } from '../subscriptions/freeze-dates'
import { defaultFeatureColumnsFor } from '../workspace/feature-flags'
import {
    DEMO_CLUB_KEY,
    DEMO_CLUB_NAME,
    DEMO_EMAIL_DOMAIN,
    DEMO_JOIN_CODE,
    DEMO_PARENT_CHILDREN,
    demoAccount,
    demoAccountName,
    type DemoAccountKey,
} from './demo-accounts'
import {
    COURSES,
    DIRECTIONS,
    FEMALE_NAMES,
    GROUPS,
    GYMS,
    LADDERS,
    MALE_NAMES,
    STAFF,
    SURNAMES,
    TARIFFS,
    femaleSurname,
    translit,
    type DirKey,
    type GroupDef,
    type GroupKey,
    type LadderDef,
    type LadderKey,
    type PersonKind,
    type StaffKey,
    type TariffDef,
    type TariffKey,
} from './demo-club.catalog'

// Builds the whole demo club as rows, deterministically: the same `now` (same
// club-local day) always yields the same rows, ids and counts, and every date
// is relative to today — the schedule, «сегодня», expirations and the history
// always look current. Pure: no I/O; demo-club.writer.ts inserts the rows.
//
// History is simulated, not sprinkled: each member has an archetype
// (regular, newcomer, drifting away, lapsed …), buys abonements in a chain and
// attends their groups' classes, and every visit is charged to the abonement
// that covered it the way session-visits does (narrowest scope, soonest end,
// packs lose a class). Achievements, the leaderboard, rank readiness, the
// at-risk list and renewals are computed by the product from these rows.

const DAY_MS = 24 * 60 * 60 * 1000
const SEED = 20_261_101
// 14 weeks: the at-risk "newcomer" rule looks 90 days back, so long-standing
// members must have visits older than that or they would read as new.
export const DEMO_HISTORY_DAYS = 98
// Six months of sales for the dashboard revenue trend.
const REVENUE_DAYS = 200
// Renewals bought before the running abonement ends: the share, and how many
// days ahead (min, max). Most renew ahead, so in any fortnight only a few
// members' access is about to run out. At most 13 days: a bought abonement
// starts by itself FIRST_VISIT_AUTO_START_DAYS (14) after the sale.
const RENEW_AHEAD_SHARE = 0.95
const RENEW_AHEAD_DAYS: [number, number] = [10, FIRST_VISIT_AUTO_START_DAYS - 1]
const FAR_FUTURE_DAYS = 5 * 365

export type DemoRoleName = 'admin' | 'head_coach' | 'coach' | 'user'

export type DemoPlanInput = {
    now: Date
    timezone: string
    personalDataConsentVersion: string
    legal: { offerVersion: string; dpaVersion: string }
}

export type DemoLiveFreeze = {
    userId: string
    subscriptionId: string
    days: number
    reason: string
}

export type DemoClubPlan = {
    workspaceId: string
    workspace: Prisma.WorkspaceCreateManyInput
    joinCode: string
    // Ids of the fixed accounts (kept across resets, so phones stay signed in).
    accountUserIds: Record<DemoAccountKey, string>
    users: Prisma.UserCreateManyInput[]
    consents: Prisma.ConsentRecordCreateManyInput[]
    guardianships: Prisma.GuardianshipCreateManyInput[]
    billing: Prisma.WorkspaceBillingCreateManyInput
    moduleEntitlements: Prisma.WorkspaceModuleEntitlementCreateManyInput[]
    legalAcceptance: Prisma.ClubLegalAcceptanceCreateManyInput
    gyms: Prisma.GymCreateManyInput[]
    directions: Prisma.DirectionCreateManyInput[]
    directionManagers: Prisma.DirectionManagerCreateManyInput[]
    plans: Prisma.PlanCreateManyInput[]
    planDirections: Prisma.PlanDirectionCreateManyInput[]
    members: {
        role: DemoRoleName
        data: Omit<Prisma.WorkspaceMemberCreateManyInput, 'roleId'>
    }[]
    groups: Prisma.GroupCreateManyInput[]
    groupCoaches: Prisma.GroupCoachCreateManyInput[]
    slots: Prisma.GroupScheduleSlotCreateManyInput[]
    scheduleExceptions: Prisma.ScheduleExceptionCreateManyInput[]
    groupMembers: Prisma.GroupMemberCreateManyInput[]
    ladders: Prisma.RankLadderCreateManyInput[]
    levels: Prisma.RankLevelCreateManyInput[]
    promotions: Prisma.RankPromotionCreateManyInput[]
    gradings: Prisma.RankGradingCreateManyInput[]
    gradingCandidates: Prisma.RankGradingCandidateCreateManyInput[]
    events: Prisma.WorkspaceEventCreateManyInput[]
    subscriptions: Prisma.SubscriptionCreateManyInput[]
    subscriptionDirections: Prisma.SubscriptionDirectionCreateManyInput[]
    sessions: Prisma.AttendanceSessionCreateManyInput[]
    records: Prisma.AttendanceRecordCreateManyInput[]
    freezeRequests: Prisma.SubscriptionFreezeRequestCreateManyInput[]
    // Applied through SubscriptionFreezeService after the rows exist, so the
    // end date and access window move exactly as for a club freeze.
    liveFreezes: DemoLiveFreeze[]
    announcements: Prisma.AnnouncementCreateManyInput[]
    achievements: Prisma.AchievementCreateManyInput[]
    videos: Prisma.VideoCreateManyInput[]
    courses: Prisma.CourseCreateManyInput[]
    chapters: Prisma.ChapterCreateManyInput[]
    courseVideos: Prisma.CourseVideoCreateManyInput[]
    courseAudiences: Prisma.CourseAudienceCreateManyInput[]
    ptCoaches: Prisma.PersonalTrainingCoachCreateManyInput[]
    ptRequests: Prisma.PersonalTrainingRequestCreateManyInput[]
    ptOptions: Prisma.PersonalTrainingOptionCreateManyInput[]
    dropIns: Prisma.DropInBookingCreateManyInput[]
    retentionContacts: Prisma.MemberRetentionContactCreateManyInput[]
    journal: Prisma.TrainingJournalEntryCreateManyInput[]
    auditEvents: Prisma.AuditEventCreateManyInput[]
}

// A stable uuid per logical entity: a reset recreates the club with the same
// ids, so an app holding the club, a child or a group keeps working.
export const demoUuid = (name: string): string => {
    const h = createHash('sha256').update(`clubspace-demo:${name}`).digest('hex')
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// mulberry32 — tiny, fast and good enough for believable noise.
const makeRng = (seed: number) => {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
    }
}

type Archetype =
    | 'fanatic'
    | 'regular'
    | 'casual'
    | 'newcomer'
    | 'stuckNewcomer'
    | 'declining'
    | 'absent'
    | 'lapsed'
    | 'churned'

type Sub = {
    id: string
    tariff: TariffDef
    chain: number
    startYmd: string
    soldAt: Date
    // Coverage window; for a pending one, endAt is the provisional access end.
    startAt: Date
    endAt: Date
    // Counted from the first training that has not happened yet.
    pending: boolean
    remaining: number | null
    isPaid: boolean
    status: 'ACTIVE' | 'EXPIRED'
}

type Person = {
    idx: number
    id: string
    firstname: string
    lastname: string
    email: string | null
    kind: PersonKind
    dob: string | null
    groups: { key: GroupKey; joinYmd: string }[]
    archetype: Archetype
    joinYmd: string
    stopYmd: string | null
    target: number
    account?: DemoAccountKey
    status: 'ACTIVE' | 'INVITED'
    subs: Sub[]
    visits: number
    note?: string
}

const pad2 = (n: number) => String(n).padStart(2, '0')

// Placeholder numbers from the +7 900 1xx-xx-xx block, stored as the product
// stores phones (+79001…). n → 6 digits is a bijection mod 10^6 (7919 is
// coprime to it), so every person gets their own number, and the numbers don't
// run in sequence down the member list.
const demoPhone = (n: number) => `+79001${String((n * 7919 + 104_729) % 1_000_000).padStart(6, '0')}`
// Parents are numbered after the members so the two never share a number.
const PARENT_PHONE_OFFSET = 10_000

export const buildDemoClubPlan = (input: DemoPlanInput): DemoClubPlan => {
    const rnd = makeRng(SEED)
    const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]

    const { now } = input
    const tz = input.timezone
    const today = localDateInTz(now, tz)
    const ago = (days: number) => addDaysYmd(today, -days)
    const ahead = (days: number) => addDaysYmd(today, days)
    const at = (ymd: string, hm: string) => wallClockToUtc(`${ymd}T${hm}`, tz)
    const dow = (ymd: string) => isoDayOfWeek(ymdToDbDate(ymd))
    // First date at or after today + `from` days that falls on `weekday`.
    const nextDow = (weekday: number, from = 1) => {
        let d = ahead(from)
        while (dow(d) !== weekday) d = addDaysYmd(d, 1)
        return d
    }
    const historyStart = ago(DEMO_HISTORY_DAYS)
    const far = new Date(now.getTime() + FAR_FUTURE_DAYS * DAY_MS)

    const workspaceId = demoUuid('workspace')
    const plan: DemoClubPlan = {
        workspaceId,
        workspace: {} as Prisma.WorkspaceCreateManyInput,
        joinCode: DEMO_JOIN_CODE,
        accountUserIds: {} as Record<DemoAccountKey, string>,
        users: [],
        consents: [],
        guardianships: [],
        billing: {} as Prisma.WorkspaceBillingCreateManyInput,
        moduleEntitlements: [],
        legalAcceptance: {} as Prisma.ClubLegalAcceptanceCreateManyInput,
        gyms: [],
        directions: [],
        directionManagers: [],
        plans: [],
        planDirections: [],
        members: [],
        groups: [],
        groupCoaches: [],
        slots: [],
        scheduleExceptions: [],
        groupMembers: [],
        ladders: [],
        levels: [],
        promotions: [],
        gradings: [],
        gradingCandidates: [],
        events: [],
        subscriptions: [],
        subscriptionDirections: [],
        sessions: [],
        records: [],
        freezeRequests: [],
        liveFreezes: [],
        announcements: [],
        achievements: [],
        videos: [],
        courses: [],
        chapters: [],
        courseVideos: [],
        courseAudiences: [],
        ptCoaches: [],
        ptRequests: [],
        ptOptions: [],
        dropIns: [],
        retentionContacts: [],
        journal: [],
        auditEvents: [],
    }

    // ---- ids -----------------------------------------------------------
    const staffId = (k: StaffKey) => demoUuid(`staff:${k}`)
    const gymId = (k: string) => demoUuid(`gym:${k}`)
    const dirId = (k: DirKey) => demoUuid(`direction:${k}`)
    const groupId = (k: GroupKey) => demoUuid(`group:${k}`)
    const slotId = (k: GroupKey, i: number) => demoUuid(`slot:${k}:${i}`)
    const tariffId = (k: TariffKey) => demoUuid(`plan:${k}`)
    const ladderId = (k: LadderKey) => demoUuid(`ladder:${k}`)
    const levelId = (k: LadderKey, order: number) => demoUuid(`level:${k}:${order}`)
    const groupDef = (k: GroupKey) => GROUPS.find((g) => g.key === k) as GroupDef
    const ladderDef = (k: LadderKey) => LADDERS.find((l) => l.key === k) as LadderDef
    const tariffDef = (k: TariffKey) => TARIFFS.find((t) => t.key === k) as TariffDef
    const ownerId = staffId('owner')
    const adminId = staffId('admin')

    // ---- club --------------------------------------------------------------
    const clubCreatedYmd = ago(760)
    plan.workspace = {
        id: workspaceId,
        key: DEMO_CLUB_KEY,
        name: DEMO_CLUB_NAME,
        type: 'GRAPPLING',
        isActive: true,
        isDemo: true,
        ownerId,
        timezone: tz,
        city: 'Томск',
        leaderboardEnabled: true,
        guestVisitsEnabled: true,
        ...defaultFeatureColumnsFor('GRAPPLING'),
        // Placeholders: never a real coach's number in the seed.
        aboutContacts: [
            { label: 'Администратор', phone: '+7 900 000-00-01' },
            { label: 'Детские группы', phone: '+7 900 000-00-02' },
            { label: 'Северск, тайский бокс', phone: '+7 900 000-00-03' },
        ],
        aboutLinks: [
            { label: 'Telegram-канал', url: 'https://t.me/academytomsk' },
            { label: 'Группа ВКонтакте', url: 'https://vk.com/academytomsk' },
            { label: 'Сайт', url: 'https://academytomsk.ru' },
        ],
        aboutRules:
            'Абонемент действует 30 дней с первой тренировки. Заморозку и отметку оплаты делает тренер вашей группы. ' +
            'Приходите за 10 минут до начала, форма чистая, ногти коротко подстрижены. ' +
            'Пробное занятие — бесплатно, в любой группе клуба.',
        aboutUpdatedAt: at(ago(40), '12:00'),
        publicDescription:
            'Сеть клубов единоборств в Томске и Северске: BJJ для взрослых и детей, ММА, тайский бокс. 10 залов по городу.',
        createdAt: at(clubCreatedYmd, '10:00'),
    }

    plan.billing = {
        workspaceId,
        status: 'ACTIVE',
        trialEndsAt: null,
        currentPeriodEnd: far,
        freeUntil: far,
        setupFeeWaived: true,
        // ~300 active students: the «business» band, comped.
        paidTierCode: 'business',
        convertedAt: at(ago(300), '12:00'),
        autopayEnabled: false,
        notes: 'Демо-клуб для показов: тариф бесплатно, все модули включены (docs/demo.md)',
    }
    plan.moduleEntitlements = (['VIDEO', 'ONLINE_PAYMENTS', 'BRANDED_APP'] as const).map(
        (module) => ({ workspaceId, module, mode: 'COMP' as const, compUntil: far }),
    )
    plan.legalAcceptance = {
        workspaceId,
        userId: ownerId,
        userEmail: demoAccount('owner').email,
        userName: demoAccountName(demoAccount('owner')),
        offerVersion: input.legal.offerVersion,
        dpaVersion: input.legal.dpaVersion,
        source: 'CONSOLE',
        acceptedAt: at(ago(300), '12:00'),
    }

    for (const g of GYMS) {
        plan.gyms.push({
            id: gymId(g.key),
            workspaceId,
            name: g.name,
            address: g.address,
            createdAt: at(clubCreatedYmd, '10:00'),
        })
    }
    DIRECTIONS.forEach((d, order) => {
        plan.directions.push({
            id: dirId(d.key),
            workspaceId,
            name: d.name,
            color: d.color,
            icon: d.icon,
            order,
        })
    })
    for (const d of DIRECTIONS) {
        plan.achievements.push(...defaultAchievementRows(workspaceId, dirId(d.key)))
    }
    plan.achievements.push(...defaultAchievementRows(workspaceId, null))

    for (const t of TARIFFS) {
        plan.plans.push({
            id: tariffId(t.key),
            workspaceId,
            name: t.name,
            description: t.description,
            price: t.price,
            currency: 'RUB',
            durationDays: t.days,
            classCount: t.classes,
            isFreeTrial: t.isFreeTrial ?? false,
            startsOnFirstVisit: t.startsOnFirstVisit ?? false,
        })
        for (const d of t.dirs) {
            plan.planDirections.push({ planId: tariffId(t.key), directionId: dirId(d) })
        }
    }

    // ---- people ------------------------------------------------------------
    const users = plan.users
    const consentFor = (userId: string, ymd: string) =>
        plan.consents.push({
            userId,
            kind: 'PERSONAL_DATA',
            version: input.personalDataConsentVersion,
            acceptedAt: at(ymd, '12:00'),
        })
    const addUser = (p: {
        id: string
        email: string | null
        firstname: string | null
        lastname: string
        createdYmd: string
        dob?: string | null
        description?: string
        lastSeenYmd?: string
        phone?: string | null
    }) => {
        users.push({
            id: p.id,
            email: p.email,
            firstname: p.firstname,
            lastname: p.lastname,
            status: 'ACTIVE',
            language: 'RU',
            isDemo: true,
            description: p.description ?? null,
            phone: p.phone ?? null,
            dateOfBirth: p.dob ? ymdToDbDate(p.dob) : null,
            personalDataConsentVersion: p.email ? input.personalDataConsentVersion : null,
            createdAt: at(p.createdYmd, '12:00'),
            lastSeenAt: at(p.lastSeenYmd ?? today, '09:00'),
        })
        if (p.email) consentFor(p.id, p.createdYmd)
    }

    for (const s of STAFF) {
        const since = s.key === 'owner' ? clubCreatedYmd : ago(int(300, 700))
        addUser({
            id: staffId(s.key),
            email: s.email,
            firstname: s.firstname,
            lastname: s.lastname,
            createdYmd: since,
            description: s.description,
        })
        plan.members.push({
            role: s.role,
            data: {
                userId: staffId(s.key),
                workspaceId,
                status: 'ACTIVE',
                createdAt: at(since, '12:00'),
                lastSeenAt: at(today, '09:00'),
            },
        })
        if (s.account) plan.accountUserIds[s.account] = staffId(s.key)
        if (s.manages) {
            plan.directionManagers.push({
                workspaceId,
                directionId: dirId(s.manages),
                userId: staffId(s.key),
            })
        }
    }

    const usedNames = new Set(STAFF.map((s) => demoAccountName(s)))
    const persons: Person[] = []
    const birthYmd = (minYears: number, maxYears: number) =>
        ago(int(minYears, maxYears) * 365 + int(0, 364))
    const freshName = (female: boolean) => {
        for (;;) {
            const first = pick(female ? FEMALE_NAMES : MALE_NAMES)
            const male = pick(SURNAMES)
            const last = female ? femaleSurname(male) : male
            if (!usedNames.has(`${first} ${last}`)) {
                usedNames.add(`${first} ${last}`)
                return { first, last }
            }
        }
    }
    const newPerson = (p: {
        kind: PersonKind
        female?: boolean
        firstname?: string | null
        lastname?: string
        email?: string | null
        account?: DemoAccountKey
        dob?: string | null
        // Children's age range, years.
        ages?: [number, number]
        groups: GroupKey[]
    }): Person => {
        const idx = persons.length + 1
        const female = p.female ?? false
        const name = p.firstname && p.lastname ? { first: p.firstname, last: p.lastname } : freshName(female)
        usedNames.add(`${name.first} ${name.last}`)
        const email =
            p.email !== undefined
                ? p.email
                : p.kind === 'kid'
                  ? null
                  : `${translit(name.first)}.${translit(name.last)}.${idx}@${DEMO_EMAIL_DOMAIN}`
        const person: Person = {
            idx,
            id: p.account ? demoUuid(`account:${p.account}`) : demoUuid(`person:${idx}`),
            firstname: name.first,
            lastname: name.last,
            email,
            kind: p.kind,
            dob:
                p.dob !== undefined
                    ? p.dob
                    : p.kind === 'kid'
                      ? birthYmd(...(p.ages ?? [6, 12]))
                      : birthYmd(18, 44),
            groups: p.groups.map((key) => ({ key, joinYmd: today })),
            archetype: 'regular',
            joinYmd: today,
            stopYmd: null,
            target: 2.4,
            account: p.account,
            status: 'ACTIVE',
            subs: [],
            visits: 0,
        }
        persons.push(person)
        return person
    }
    const setJoin = (p: Person, sinceDays: number) => {
        p.joinYmd = ago(sinceDays)
        p.groups.forEach((g) => (g.joinYmd = p.joinYmd))
    }

    // The fixed demo people first.
    const studentAcc = demoAccount('student')
    const student = newPerson({
        kind: 'adult',
        firstname: studentAcc.firstname,
        lastname: studentAcc.lastname,
        email: studentAcc.email,
        account: 'student',
        dob: ago(29 * 365 + 120),
        groups: ['dvBjjEvening', 'dvMma'],
    })
    setJoin(student, 262)
    student.target = 2.5
    const parentAcc = demoAccount('parent')
    const parent = newPerson({
        kind: 'adult',
        female: true,
        firstname: parentAcc.firstname,
        lastname: parentAcc.lastname,
        email: parentAcc.email,
        account: 'parent',
        dob: ago(36 * 365 + 40),
        groups: ['dvBjjMorning'],
    })
    setJoin(parent, 150)
    parent.target = 2
    const [mishaName, anyaName] = DEMO_PARENT_CHILDREN
    const misha = newPerson({
        kind: 'kid',
        firstname: mishaName.firstname,
        lastname: mishaName.lastname,
        dob: ago(11 * 365 + 77),
        groups: ['dvKidsSenior'],
    })
    misha.id = demoUuid('child:misha')
    setJoin(misha, 210)
    misha.target = 1.9
    const anya = newPerson({
        kind: 'kid',
        female: true,
        firstname: anyaName.firstname,
        lastname: anyaName.lastname,
        dob: ago(7 * 365 + 200),
        groups: ['dvKidsJunior'],
    })
    anya.id = demoUuid('child:anya')
    setJoin(anya, 125)
    anya.target = 1.6
    const fixedPeople = new Set([student, parent, misha, anya])

    const femaleShare = (g: GroupDef) =>
        g.kind === 'kid' ? 0.3 : g.dir === 'muay' ? 0.35 : g.dir === 'mma' ? 0.1 : 0.15
    const inGroup = (k: GroupKey) => persons.filter((p) => p.groups.some((g) => g.key === k))
    for (const g of GROUPS) {
        while (inGroup(g.key).length < g.size) {
            newPerson({ kind: g.kind, female: rnd() < femaleShare(g), ages: g.ages, groups: [g.key] })
        }
    }

    // Archetypes for the generated people.
    const shuffle = <T>(list: T[]): T[] => {
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1))
            ;[list[i], list[j]] = [list[j], list[i]]
        }
        return list
    }
    const generatedOlder = persons.filter((p) => !fixedPeople.has(p) && p.kind !== 'kid')
    // A healthy club: about one in ten slipping away (the at-risk list), a few
    // who left long ago, the rest training.
    const quotas: [Archetype, number][] = [
        ['fanatic', 10],
        ['newcomer', 12],
        ['stuckNewcomer', 3],
        ['declining', 5],
        ['absent', 3],
        ['lapsed', 5],
        ['churned', 10],
        ['casual', 26],
    ]
    const deck: Archetype[] = quotas.flatMap(([a, n]) => Array<Archetype>(n).fill(a))
    while (deck.length < generatedOlder.length) deck.push('regular')
    shuffle(deck)
    generatedOlder.forEach((p, i) => (p.archetype = deck[i]))
    const generatedKids = persons.filter((p) => !fixedPeople.has(p) && p.kind === 'kid')
    generatedKids.forEach(
        (p, i) =>
            (p.archetype =
                i % 15 === 3 ? 'newcomer' : i % 37 === 7 ? 'declining' : i % 41 === 11 ? 'lapsed' : 'regular'),
    )

    for (const p of persons) {
        if (fixedPeople.has(p)) continue
        const since =
            p.archetype === 'newcomer'
                ? int(4, 24)
                : p.archetype === 'stuckNewcomer'
                  ? int(20, 34)
                  : p.archetype === 'churned'
                    ? // Left 3–5 months ago, after a long run.
                      int(300, 720)
                    : p.kind === 'kid'
                      ? int(100, 500)
                      : int(110, 720)
        setJoin(p, since)
        p.target =
            p.kind === 'kid'
                ? 1.6 + rnd() * 0.4
                : {
                      fanatic: 4.5,
                      regular: 2.2 + rnd() * 0.6,
                      casual: 1.4 + rnd() * 0.4,
                      newcomer: 2.2,
                      stuckNewcomer: 2,
                      declining: 2.6,
                      absent: 2.4,
                      lapsed: 2.2,
                      churned: 2,
                  }[p.archetype]
    }

    // Some train two directions: one combined tariff (БЖЖ + ММА) or two
    // separate abonements.
    const secondGroup = (p: Person, key: GroupKey) =>
        p.groups.push({ key, joinYmd: addDaysYmd(p.joinYmd, int(10, 60)) })
    const crossFrom = (from: GroupKey, to: GroupKey, n: number, kinds: Archetype[]) =>
        persons
            .filter(
                (p) =>
                    !fixedPeople.has(p) &&
                    p.kind === 'adult' &&
                    p.groups.length === 1 &&
                    p.groups[0].key === from &&
                    kinds.includes(p.archetype),
            )
            .slice(0, n)
            .forEach((p) => secondGroup(p, to))
    const fanaticExtra: Record<DirKey, GroupKey> = {
        bjj: 'dvMma',
        mma: 'dvBjjEvening',
        muay: 'dvBjjEvening',
    }
    persons
        .filter((p) => p.archetype === 'fanatic' && p.kind === 'adult' && p.groups.length === 1)
        .forEach((p) => secondGroup(p, fanaticExtra[groupDef(p.groups[0].key).dir]))
    crossFrom('dvBjjEvening', 'dvMma', 5, ['regular'])
    crossFrom('yuBjj', 'rysMma', 3, ['regular'])
    crossFrom('shBjjEvening', 'svMuay', 3, ['regular', 'casual'])
    crossFrom('rysMma', 'yuBjj', 2, ['regular'])

    // Two people who applied through the QR and wait for approval.
    const applicants = [0, 1].map(() => {
        const p = newPerson({ kind: 'adult', female: rnd() < 0.3, groups: [] })
        p.status = 'INVITED'
        p.joinYmd = today
        return p
    })

    // ---- tariffs and abonement chains ------------------------------------------
    const dirsOf = (p: Person) => [...new Set(p.groups.map((g) => groupDef(g.key).dir))]
    const tariffsFor = (p: Person): TariffDef[] => {
        if (p.status === 'INVITED') return []
        if (p.kind === 'kid') return [tariffDef(rnd() < 0.7 ? 'pack8' : 'pack12')]
        if (p.archetype === 'fanatic') return [tariffDef('unlim')]
        const dirs = dirsOf(p)
        if (dirs.includes('bjj') && dirs.includes('mma')) return [tariffDef('bjjMma12')]
        // Two abonements: the club pack for BJJ in Томск, тайский in Северск.
        if (dirs.includes('muay') && dirs.length === 2) return [tariffDef('pack8'), tariffDef('muay12')]
        if (dirs.includes('muay')) return [tariffDef(rnd() < 0.6 ? 'muay12' : 'pack12')]
        if (p.archetype === 'casual') return [tariffDef(rnd() < 0.1 ? 'single' : 'pack8')]
        return [tariffDef(rnd() < 0.15 ? 'unlim' : 'pack12')]
    }
    const newSub = (p: Person, t: TariffDef, chain: number, startYmd: string, endYmd: string): Sub => {
        // Sold at the reception before the first class of the day. A tariff
        // counted from the first training starts at that day's club midnight
        // (first-visit-start.ts); the first visit is that day.
        const saleTime = `07:${pad2(int(0, 59))}`
        const coverFrom = t.startsOnFirstVisit ? '00:00' : saleTime
        return {
            id: demoUuid(`sub:${p.idx}:${chain}:${startYmd}`),
            tariff: t,
            chain,
            startYmd,
            soldAt: at(startYmd, saleTime),
            startAt: at(startYmd, coverFrom),
            endAt: at(endYmd, coverFrom),
            pending: false,
            remaining: t.classes,
            isPaid: true,
            status: 'ACTIVE',
        }
    }

    for (const p of persons) {
        const tariffs = tariffsFor(p)
        if (tariffs.length === 0) continue
        const since = diffDaysYmd(today, p.joinYmd)
        if (p.archetype === 'newcomer' || p.archetype === 'stuckNewcomer') {
            p.subs.push(newSub(p, tariffDef('trial'), 9, p.joinYmd, addDaysYmd(p.joinYmd, 14)))
            if (since >= 10) {
                const start = addDaysYmd(p.joinYmd, int(1, 3))
                p.subs.push(newSub(p, tariffs[0], 0, start, addDaysYmd(start, tariffs[0].days)))
            } else if (p.idx % 4 !== 0) {
                // Bought after the trial, waits for the first training.
                const sale = newSub(p, tariffs[0], 0, ago(int(0, 2)), today)
                sale.pending = true
                sale.endAt = at(addDaysYmd(sale.startYmd, 14 + tariffs[0].days), '00:00')
                p.subs.push(sale)
            }
            continue
        }
        const floor = p.joinYmd > ago(REVENUE_DAYS) ? p.joinYmd : ago(REVENUE_DAYS)
        tariffs.forEach((t, chain) => {
            let end =
                p.archetype === 'lapsed'
                    ? ago(int(2, 26))
                    : p.archetype === 'churned'
                      ? ago(int(100, 150))
                      : p.archetype === 'absent'
                        ? ahead(int(8, 26))
                        : ahead(int(1, t.days - 1))
            if (p.archetype === 'lapsed' || p.archetype === 'churned') {
                const stop = addDaysYmd(end, -int(0, 4))
                if (!p.stopYmd || stop > p.stopYmd) p.stopYmd = stop
            }
            const chainSubs: Sub[] = []
            while (end > floor) {
                const start = addDaysYmd(end, -t.days)
                chainSubs.unshift(newSub(p, t, chain, start < p.joinYmd ? p.joinYmd : start, end))
                if (start <= floor) break
                end = addDaysYmd(start, rnd() < 0.25 ? -int(1, 3) : 0)
            }
            // Renewals were mostly bought ahead, like the ones pending today
            // (below), so every month of the revenue trend has the same mix.
            for (const s of chainSubs) {
                if (s.startYmd === p.joinYmd || rnd() >= RENEW_AHEAD_SHARE) continue
                s.soldAt = new Date(s.soldAt.getTime() - int(...RENEW_AHEAD_DAYS) * DAY_MS)
            }
            p.subs.push(...chainSubs)
        })
        if (p.archetype === 'absent') p.stopYmd = ago(int(15, 30))
    }

    // Classes bought before the visible history were partly used already.
    for (const p of persons) {
        for (const s of p.subs) {
            if (s.remaining === null || s.startYmd >= historyStart) continue
            const before = Math.min(diffDaysYmd(historyStart, s.startYmd), s.tariff.days)
            const chains = new Set(p.subs.map((x) => x.chain)).size
            const used = Math.round((p.target / chains) * (before / 7))
            s.remaining = Math.max(0, s.remaining - Math.min(used, s.remaining))
        }
    }

    // ---- groups and schedule -------------------------------------------------
    for (const g of GROUPS) {
        plan.groups.push({
            id: groupId(g.key),
            workspaceId,
            // Branches reuse names («Дети Старшие»): the branch tells them apart.
            name: `${g.name} · ${GYMS.find((x) => x.key === g.gym)?.short}`,
            gymId: gymId(g.gym),
            directionId: dirId(g.dir),
            coachId: staffId(g.coach),
            createdAt: at(clubCreatedYmd, '11:00'),
        })
        plan.groupCoaches.push({ groupId: groupId(g.key), userId: staffId(g.coach), role: 'primary' })
        g.slots.forEach(([dayOfWeek, startTime, durationMin], i) => {
            plan.slots.push({ id: slotId(g.key, i), groupId: groupId(g.key), dayOfWeek, startTime, durationMin })
        })
    }
    // A cancelled week in the past (no sessions then) and one ahead.
    const pastBreak = { group: 'rysMma' as GroupKey, from: ago(17), until: ago(11) }
    plan.scheduleExceptions.push({
        groupId: groupId(pastBreak.group),
        slotId: null,
        fromDate: ymdToDbDate(pastBreak.from),
        untilDate: ymdToDbDate(pastBreak.until),
        reason: 'Тренер на сборах',
    })
    const busySaturday = nextDow(6, 3)
    plan.scheduleExceptions.push({
        groupId: groupId('yvKidsJunior'),
        slotId: slotId('yvKidsJunior', 1),
        fromDate: ymdToDbDate(busySaturday),
        untilDate: ymdToDbDate(busySaturday),
        reason: 'Зал занят под турнир',
    })

    // ---- visits ----------------------------------------------------------------
    const slotsPerWeek = (p: Person) =>
        p.groups.reduce((n, g) => n + groupDef(g.key).slots.length, 0) || 1
    const chance = (p: Person, groupJoin: string, ymd: string): number => {
        if (ymd < groupJoin) return 0
        if (p.stopYmd && ymd > p.stopYmd) return 0
        const base = Math.min(0.95, p.target / slotsPerWeek(p))
        if (p.archetype === 'declining' && ymd >= ago(28)) return base * 0.06
        if (p.archetype === 'stuckNewcomer') return ymd > addDaysYmd(p.joinYmd, 6) ? 0.02 : 0.9
        return base
    }
    const covers = (s: Sub, dir: DirKey | null) =>
        s.tariff.dirs.length === 0 || (dir !== null && s.tariff.dirs.includes(dir))
    // session-visits' order: narrowest scope, soonest end.
    const coveringSub = (p: Person, dir: DirKey, instant: Date): Sub | null =>
        p.subs
            .filter(
                (s) =>
                    !s.pending &&
                    s.startAt <= instant &&
                    instant < s.endAt &&
                    covers(s, dir) &&
                    (s.remaining === null || s.remaining > 0),
            )
            .sort(
                (a, b) =>
                    (a.tariff.dirs.length || 99) - (b.tariff.dirs.length || 99) ||
                    a.endAt.getTime() - b.endAt.getTime(),
            )[0] ?? null
    const recordVisit = (
        p: Person,
        sessionId: string,
        markedById: string,
        startAt: Date,
        sub: Sub | null,
    ) => {
        const consumed = sub && sub.remaining !== null
        if (sub && sub.remaining !== null) sub.remaining -= 1
        p.visits += 1
        plan.records.push({
            sessionId,
            workspaceId,
            userId: p.id,
            markedById,
            markedAt: new Date(startAt.getTime() + int(5, 20) * 60_000),
            usedSubscriptionId: sub?.id ?? null,
            consumedSubscriptionId: consumed ? sub.id : null,
        })
    }

    const members = persons.filter((p) => p.status === 'ACTIVE')
    const lastVisit = new Map<string, string>()
    for (let ymd = historyStart; ymd < today; ymd = addDaysYmd(ymd, 1)) {
        const weekday = dow(ymd)
        for (const g of GROUPS) {
            if (g.key === pastBreak.group && ymd >= pastBreak.from && ymd <= pastBreak.until) continue
            g.slots.forEach(([day, time], i) => {
                if (day !== weekday) return
                const startAt = at(ymd, time)
                const sessionId = demoUuid(`session:${g.key}:${i}:${ymd}`)
                const before = plan.records.length
                const roster = members.filter((p) => p.groups.some((x) => x.key === g.key))
                // Saturday BJJ at «Шарики»: some from «Юпитер» drop in.
                const guests =
                    g.key === 'shBjjEvening' && day === 6
                        ? members.filter(
                              (p) =>
                                  p.groups.some((x) => x.key === 'yuBjj') &&
                                  !p.groups.some((x) => x.key === 'shBjjEvening'),
                          )
                        : []
                for (const p of roster) {
                    const join = p.groups.find((x) => x.key === g.key)!.joinYmd
                    if (rnd() >= chance(p, join, ymd)) continue
                    const sub = coveringSub(p, g.dir, startAt)
                    if (!sub) continue
                    recordVisit(p, sessionId, staffId(g.coach), startAt, sub)
                    lastVisit.set(p.id, ymd)
                }
                for (const p of guests) {
                    if (rnd() >= chance(p, p.joinYmd, ymd) * 0.25) continue
                    const sub = coveringSub(p, g.dir, startAt)
                    if (!sub) continue
                    recordVisit(p, sessionId, staffId(g.coach), startAt, sub)
                    lastVisit.set(p.id, ymd)
                }
                if (plan.records.length > before) {
                    plan.sessions.push({
                        id: sessionId,
                        workspaceId,
                        groupId: groupId(g.key),
                        slotId: slotId(g.key, i),
                        sessionDate: ymdToDbDate(ymd),
                        occurrenceKey: scheduledOccurrenceKey(slotId(g.key, i), ymd),
                        title: g.name,
                        startAt,
                        timezone: tz,
                        coachId: staffId(g.coach),
                        createdById: staffId(g.coach),
                        createdAt: startAt,
                    })
                }
            })
        }
    }

    // A pack used up and then renewed was closed by the sale.
    for (const p of persons) {
        for (const s of p.subs) {
            const renewed = p.subs.some((x) => x.chain === s.chain && x.startAt > s.startAt)
            if (s.remaining === 0 && renewed) s.status = 'EXPIRED'
        }
    }

    // Most people renew before the abonement runs out: the next one is bought
    // ahead (paid, waiting for its first visit), so at any moment only part of
    // the club is in «К продлению» and «Доступ истекает», as in a healthy club.
    // Same share and lead time as the past renewals above, so the sales of the
    // last weeks don't spike in the revenue trend.
    const renewsAhead: Archetype[] = ['regular', 'fanatic', 'casual']
    for (const p of members) {
        if (fixedPeople.has(p) || !renewsAhead.includes(p.archetype)) continue
        const current = p.subs.filter(
            (s) =>
                !s.pending &&
                s.tariff.key !== 'trial' &&
                s.tariff.key !== 'single' &&
                s.startAt <= now &&
                s.endAt > now,
        )
        for (const s of current) {
            if (rnd() >= RENEW_AHEAD_SHARE) continue
            const lead = int(...RENEW_AHEAD_DAYS)
            const daysLeft = Math.ceil((s.endAt.getTime() - now.getTime()) / DAY_MS)
            // One class left is the usual moment to renew (it shows in «К
            // продлению» until then); a used-up pack can't wait.
            const usedUp = s.remaining === 0
            if (!usedUp && daysLeft > lead) continue
            // A used-up pack is renewed after the last visit (a visit since
            // would have started the new one); otherwise `lead` days before the
            // end, but after the running one started.
            const last = lastVisit.get(p.id)
            const earliest =
                usedUp && last && last >= s.startYmd ? addDaysYmd(last, 1) : addDaysYmd(s.startYmd, 1)
            const wanted = usedUp ? ago(int(0, 3)) : addDaysYmd(today, daysLeft - lead)
            const saleYmd = wanted >= earliest ? wanted : earliest > today ? today : earliest
            const next = newSub(p, s.tariff, s.chain, saleYmd, today)
            if (p.subs.some((x) => x.id === next.id)) continue
            next.pending = true
            next.endAt = at(addDaysYmd(saleYmd, FIRST_VISIT_AUTO_START_DAYS + s.tariff.days), '00:00')
            // Bought in the morning, but never later than now.
            next.soldAt = new Date(Math.min(next.soldAt.getTime(), now.getTime() - 30 * 60_000))
            p.subs.push(next)
        }
    }

    // ---- states on top: debts, freezes, freeze requests ------------------------
    const currentSub = (p: Person) =>
        p.subs.find((s) => !s.pending && s.startAt <= now && s.endAt > now && s.tariff.key !== 'trial') ?? null
    const steady = members.filter((p) => {
        if (fixedPeople.has(p) || p.archetype !== 'regular' || p.kind !== 'adult') return false
        if (p.subs.some((s) => s.pending)) return false
        if (new Set(p.subs.map((s) => s.chain)).size !== 1) return false
        const s = currentSub(p)
        return (
            !!s &&
            s.startAt.getTime() <= now.getTime() - 3 * DAY_MS &&
            s.endAt.getTime() > now.getTime() + 6 * DAY_MS &&
            (s.remaining === null || s.remaining > 2)
        )
    })
    const [debtors, frozen, requesters, declined] = [
        steady.slice(0, 4),
        steady.slice(4, 7),
        steady.slice(7, 9),
        steady.slice(9, 10),
    ]
    for (const p of debtors) currentSub(p)!.isPaid = false
    const lapsedDebtor = members.find((p) => p.archetype === 'lapsed' && p.subs.length > 0)
    if (lapsedDebtor) lapsedDebtor.subs[lapsedDebtor.subs.length - 1].isPaid = false
    const freezeReasons = ['Травма плеча', 'Отпуск', 'Командировка']
    frozen.forEach((p, i) =>
        plan.liveFreezes.push({
            userId: p.id,
            subscriptionId: currentSub(p)!.id,
            days: [14, 10, 21][i],
            reason: freezeReasons[i],
        }),
    )
    const requestReasons = ['Командировка в Казань', 'Травма колена, жду МРТ']
    requesters.forEach((p, i) => {
        const s = currentSub(p)!
        plan.freezeRequests.push({
            workspaceId,
            subscriptionId: s.id,
            userId: p.id,
            pendingSubscriptionId: s.id,
            status: 'PENDING',
            fromDate: ymdToDbDate(ahead(3 + i)),
            days: [10, 21][i],
            reason: requestReasons[i],
            createdAt: new Date(now.getTime() - (i + 1) * 5 * 60 * 60 * 1000),
        })
    })
    declined.forEach((p) => {
        const s = currentSub(p)!
        plan.freezeRequests.push({
            workspaceId,
            subscriptionId: s.id,
            userId: p.id,
            pendingSubscriptionId: null,
            status: 'DECLINED',
            fromDate: ymdToDbDate(ago(5)),
            days: 30,
            reason: 'Хочу отдохнуть месяц',
            decidedById: adminId,
            decidedAt: at(ago(6), '13:00'),
            decisionComment: 'Заморозка до 21 дня по правилам клуба — можем заморозить на 3 недели',
            createdAt: at(ago(7), '10:00'),
        })
    })

    // ---- subscriptions as rows -------------------------------------------------
    for (const p of persons) {
        for (const s of p.subs) {
            plan.subscriptions.push({
                id: s.id,
                workspaceId,
                planId: tariffId(s.tariff.key),
                status: s.status,
                startDate: s.pending ? null : s.startAt,
                endDate: s.pending ? null : s.endAt,
                startsOnFirstVisit: s.tariff.startsOnFirstVisit ?? false,
                durationDays: s.tariff.days,
                amountPaid: s.tariff.price,
                currency: 'RUB',
                isPaid: s.isPaid,
                paidAt: s.isPaid ? s.soldAt : null,
                classesTotal: s.tariff.classes,
                classesRemaining: s.remaining,
                workspaceMemberId: demoUuid(`member:${p.idx}`),
                source: 'MANUAL',
                createdAt: s.soldAt,
            })
            for (const d of s.tariff.dirs) {
                plan.subscriptionDirections.push({ subscriptionId: s.id, directionId: dirId(d) })
            }
        }
    }

    // ---- members, users, families ------------------------------------------------
    const notes = [
        'Травма плеча — без бросков до конца месяца',
        'Готовится к турниру, просил больше спаррингов',
        'Оплачивает компания, счёт на юрлицо',
    ]
    const activeRecently = (p: Person) =>
        !p.stopYmd || p.stopYmd >= ago(14)
    members.concat(applicants).forEach((p, i) => {
        const accessUntil = p.subs.reduce<Date | null>(
            (max, s) => (!max || s.endAt > max ? s.endAt : max),
            null,
        )
        const seen =
            p.status === 'INVITED'
                ? today
                : activeRecently(p)
                  ? ago(int(0, 6))
                  : (p.stopYmd ?? p.joinYmd)
        addUser({
            id: p.id,
            email: p.email,
            firstname: p.firstname,
            lastname: p.lastname,
            createdYmd: p.joinYmd,
            dob: p.dob,
            lastSeenYmd: seen,
            // A child has no phone of its own: the club calls the parents.
            phone: p.kind === 'kid' ? null : demoPhone(p.idx),
        })
        if (p.account) plan.accountUserIds[p.account] = p.id
        plan.members.push({
            role: 'user',
            data: {
                id: demoUuid(`member:${p.idx}`),
                userId: p.id,
                workspaceId,
                status: p.status,
                accessUntil,
                createdAt:
                    p.status === 'INVITED'
                        ? new Date(now.getTime() - (i % 2 === 0 ? 3 : 26) * 60 * 60 * 1000)
                        : at(p.joinYmd, '12:00'),
                lastSeenAt: at(seen, '20:00'),
                notificationsMuted: !p.account,
                notes: !p.account && i % 37 === 5 ? notes[Math.floor(i / 37) % notes.length] : null,
            },
        })
        for (const g of p.groups) {
            plan.groupMembers.push({ groupId: groupId(g.key), userId: p.id, joinedAt: at(g.joinYmd, '12:00') })
        }
    })

    // Parents: Елена (demo account) with Миша and Аня, four more confirmed
    // parents, and the rest of the kids with an invitation still pending.
    const kids = members.filter((p) => p.kind === 'kid')
    const confirmGuardian = (guardianId: string, child: Person, ymd: string, invitedByClub: boolean) => {
        plan.guardianships.push({
            guardianId,
            dependentId: child.id,
            relation: 'PARENT',
            invitedByWorkspaceId: invitedByClub ? workspaceId : null,
            invitedById: invitedByClub ? adminId : null,
            consentAt: at(ymd, '19:00'),
            consentVersion: GUARDIAN_CONSENT_VERSION,
            createdAt: at(ymd, '18:00'),
        })
        plan.consents.push({
            userId: guardianId,
            kind: 'DEPENDENT_DATA',
            version: GUARDIAN_CONSENT_VERSION,
            acceptedAt: at(ymd, '19:00'),
            dependentId: child.id,
        })
    }
    confirmGuardian(parent.id, misha, misha.joinYmd, false)
    confirmGuardian(parent.id, anya, anya.joinYmd, false)
    kids
        .filter((k) => k !== misha && k !== anya)
        .forEach((kid, i) => {
            const female = rnd() < 0.7
            const base = kid.lastname.endsWith('а') ? kid.lastname.slice(0, -1) : kid.lastname
            const parentId = demoUuid(`parent:${kid.idx}`)
            const first = pick(female ? FEMALE_NAMES : MALE_NAMES)
            addUser({
                id: parentId,
                email: `${translit(first)}.${translit(base)}.parent${kid.idx}@${DEMO_EMAIL_DOMAIN}`,
                firstname: first,
                lastname: female ? femaleSurname(base) : base,
                createdYmd: kid.joinYmd,
                phone: demoPhone(PARENT_PHONE_OFFSET + kid.idx),
            })
            if (i < 4) {
                confirmGuardian(parentId, kid, kid.joinYmd, true)
            } else {
                plan.guardianships.push({
                    guardianId: parentId,
                    dependentId: kid.id,
                    relation: 'PARENT',
                    invitedByWorkspaceId: workspaceId,
                    invitedById: adminId,
                    consentAt: null,
                    createdAt: at(kid.joinYmd, '18:00'),
                })
            }
        })

    // ---- ranks ----------------------------------------------------------------
    LADDERS.forEach((l, order) => {
        plan.ladders.push({
            id: ladderId(l.key),
            workspaceId,
            name: l.name,
            audience: l.audience,
            order,
            directionId: dirId(l.dir),
            createdAt: at(clubCreatedYmd, '12:00'),
        })
        l.levels.forEach((lv, i) =>
            plan.levels.push({
                id: levelId(l.key, i),
                ladderId: ladderId(l.key),
                name: lv.name,
                order: i,
                color: lv.color,
                maxStripes: l.maxStripes,
                requirements: lv.requirements ?? null,
                minVisits: lv.minVisits ?? null,
                minWeeks: lv.minWeeks ?? null,
            }),
        )
    })
    type Rank = { level: number; stripes: number; ymd: string }
    const ranks = new Map<string, Rank[]>()
    const promote = (p: Person, l: LadderDef, r: Rank, note: string | null = null) => {
        const key = `${p.id}:${l.key}`
        ranks.set(key, [...(ranks.get(key) ?? []), r])
        const id = demoUuid(`promotion:${p.idx}:${l.key}:${r.ymd}:${r.level}:${r.stripes}`)
        plan.promotions.push({
            id,
            workspaceId,
            userId: p.id,
            ladderId: ladderId(l.key),
            levelId: levelId(l.key, r.level),
            stripes: r.stripes,
            note,
            awardedById: staffId(l.coach),
            awardedAt: at(r.ymd, '20:30'),
        })
        return id
    }
    for (const p of members) {
        const ladders = [...new Set(p.groups.map((g) => groupDef(g.key).ladder))]
        for (const lk of ladders) {
            const l = ladderDef(lk)
            const join = p.groups
                .filter((g) => groupDef(g.key).ladder === lk)
                .map((g) => g.joinYmd)
                .sort()[0]
            promote(p, l, { level: 0, stripes: 0, ymd: join })
            let level = 0
            let stripes = 0
            let t = addDaysYmd(join, l.stepDays + int(-10, 10))
            while (t < ago(5)) {
                if (l.maxStripes > 0 && stripes < l.maxStripes) {
                    stripes += 1
                    promote(p, l, { level, stripes, ymd: t })
                } else if (level + 1 < l.levels.length && rnd() < (lk === 'bjj' ? 0.55 : 0.7)) {
                    level += 1
                    stripes = 0
                    promote(p, l, { level, stripes, ymd: t }, 'Аттестация')
                } else {
                    break
                }
                t = addDaysYmd(t, Math.round(l.stepDays * (l.maxStripes > 0 ? 1 : 1.3)) + int(-10, 15))
            }
        }
    }
    const currentRank = (p: Person, lk: LadderKey) => {
        const list = ranks.get(`${p.id}:${lk}`) ?? []
        return list[list.length - 1]
    }
    const bjj = ladderDef('bjj')
    const bjjKids = ladderDef('bjjKids')
    const bjjAdults = members.filter(
        (p) => p.kind === 'adult' && currentRank(p, 'bjj')?.level === 0,
    )

    // A past БЖЖ grading with results, and two upcoming ones with candidates.
    const pastGrading = ago(42)
    const pastGradingId = demoUuid('grading:past')
    plan.gradings.push({
        id: pastGradingId,
        workspaceId,
        ladderId: ladderId('bjj'),
        date: ymdToDbDate(pastGrading),
        title: 'Аттестация БЖЖ — полоски',
        gymId: gymId('yupiter'),
        feeAmount: 1500,
        feeCurrency: 'RUB',
        createdById: staffId('reshetyuk'),
        createdAt: at(addDaysYmd(pastGrading, -21), '12:00'),
    })
    bjjAdults
        .filter((p) => {
            const r = currentRank(p, 'bjj')!
            return (
                !fixedPeople.has(p) &&
                r.ymd < addDaysYmd(pastGrading, -30) &&
                r.stripes < 4 &&
                p.joinYmd < addDaysYmd(pastGrading, -120) &&
                (!p.stopYmd || p.stopYmd > pastGrading)
            )
        })
        .slice(0, 5)
        .forEach((p, i) => {
            const r = currentRank(p, 'bjj')!
            const passed = i < 4
            const promotionId = passed
                ? promote(p, bjj, { level: 0, stripes: r.stripes + 1, ymd: pastGrading }, 'Аттестация')
                : null
            plan.gradingCandidates.push({
                gradingId: pastGradingId,
                workspaceId,
                userId: p.id,
                levelId: levelId('bjj', 0),
                stripes: r.stripes + 1,
                fromLevelName: 'Белый',
                fromStripes: r.stripes,
                result: passed ? 'PASSED' : 'FAILED',
                resultAt: at(pastGrading, '16:00'),
                promotionId,
                paidAt: at(addDaysYmd(pastGrading, -3), '19:00'),
            })
        })

    const visitsSince = (p: Person, ymd: string) =>
        plan.records.filter(
            (r) => r.userId === p.id && (r.markedAt as Date) >= at(ymd, '00:00'),
        ).length
    const readiness = (p: Person) => {
        const run = (ranks.get(`${p.id}:bjj`) ?? []).filter((r) => r.level === 0)
        const reached = run[0]?.ymd ?? p.joinYmd
        const blue = bjj.levels[1]
        const visits = visitsSince(p, reached)
        return {
            visits,
            ready:
                visits >= (blue.minVisits ?? 0) &&
                Math.floor(diffDaysYmd(today, reached) / 7) >= (blue.minWeeks ?? 0),
        }
    }
    const nextGradingYmd = ahead(12)
    const nextGradingId = demoUuid('grading:next')
    plan.gradings.push({
        id: nextGradingId,
        workspaceId,
        ladderId: ladderId('bjj'),
        date: ymdToDbDate(nextGradingYmd),
        title: 'Аттестация БЖЖ: синие пояса',
        gymId: gymId('dvorets'),
        feeAmount: 2000,
        feeCurrency: 'RUB',
        createdById: staffId('reshetyuk'),
        createdAt: at(ago(9), '12:00'),
    })
    const scored = bjjAdults
        .filter((p) => !fixedPeople.has(p) && activeRecently(p))
        .map((p) => ({ p, ...readiness(p) }))
        .sort((a, b) => b.visits - a.visits)
    const nextCandidates = [
        student,
        ...scored.filter((s) => s.ready).slice(0, 6).map((s) => s.p),
        ...scored.filter((s) => !s.ready).slice(0, 2).map((s) => s.p),
    ]
    nextCandidates.forEach((p, i) => {
        const r = currentRank(p, 'bjj')!
        plan.gradingCandidates.push({
            gradingId: nextGradingId,
            workspaceId,
            userId: p.id,
            levelId: levelId('bjj', 1),
            stripes: 0,
            fromLevelName: 'Белый',
            fromStripes: r.stripes,
            result: 'PENDING',
            paidAt: i % 2 === 0 ? at(ago(1 + (i % 4)), '19:00') : null,
        })
    })
    const kidsGradingId = demoUuid('grading:kids')
    plan.gradings.push({
        id: kidsGradingId,
        workspaceId,
        ladderId: ladderId('bjjKids'),
        date: ymdToDbDate(ahead(19)),
        title: 'Детская аттестация БЖЖ',
        gymId: gymId('dvorets'),
        feeAmount: 1000,
        feeCurrency: 'RUB',
        createdById: staffId('savelyev'),
        createdAt: at(ago(4), '12:00'),
    })
    const kidCandidates = [
        misha,
        ...kids
            .filter((k) => k !== misha && currentRank(k, 'bjjKids') !== undefined)
            .sort((a, b) => b.visits - a.visits)
            .slice(0, 4),
    ]
    kidCandidates.forEach((k) => {
        const r = currentRank(k, 'bjjKids')!
        const next = Math.min(r.level + 1, bjjKids.levels.length - 1)
        plan.gradingCandidates.push({
            gradingId: kidsGradingId,
            workspaceId,
            userId: k.id,
            levelId: levelId('bjjKids', next),
            stripes: 0,
            fromLevelName: bjjKids.levels[r.level].name,
            fromStripes: r.stripes,
            result: 'PENDING',
        })
    })

    // ---- events (open mat with visits, seminar, …) --------------------------------
    const nextSat = nextDow(6)
    const prevSat = (() => {
        let d = ago(1)
        while (dow(d) !== 6) d = addDaysYmd(d, -1)
        return d
    })()
    const eventDefs: {
        key: string
        title: string
        description: string
        ymd: string
        time: string
        hours: number
        gym: string
        dir: DirKey | null
        coach: StaffKey | null
        by: StaffKey
        link?: string
    }[] = [
        { key: 'openmat-past', title: 'Open mat BJJ', description: 'Свободные спарринги для всех уровней и всех залов. Можно в ги и без.', ymd: prevSat, time: '17:00', hours: 2, gym: 'dvorets', dir: 'bjj', coach: 'savelyev', by: 'savelyev' },
        { key: 'openmat-next', title: 'Open mat BJJ', description: 'Свободные спарринги для всех уровней и всех залов. Можно в ги и без.', ymd: nextSat, time: '17:00', hours: 2, gym: 'dvorets', dir: 'bjj', coach: 'savelyev', by: 'savelyev' },
        { key: 'seminar', title: 'Семинар: проходы гарда — гость клуба, чёрный пояс', description: 'Три часа техники и вопросов. Для синих поясов и старше, белым — по согласованию с тренером.', ymd: addDaysYmd(nextSat, 7), time: '12:00', hours: 3, gym: 'yupiter', dir: 'bjj', coach: null, by: 'reshetyuk', link: 'https://academytomsk.ru' },
        { key: 'mma-sparring', title: 'Спарринг-день ММА', description: 'Раунды по 3 минуты, перчатки и капа обязательны.', ymd: ahead(6), time: '19:00', hours: 2, gym: 'rys', dir: 'mma', coach: 'starokorov', by: 'starokorov' },
        { key: 'muay-clinch', title: 'Мастер-класс: клинч и колени', description: 'Работа в клинче с Романом Савельевым. Северск, приезжайте из Томска.', ymd: ahead(9), time: '14:00', hours: 2, gym: 'seversk', dir: 'muay', coach: 'savelyev', by: 'savelyev' },
        { key: 'kids-cup', title: 'Детский турнир по BJJ «Кубок ACADEMY»', description: 'Для детей 5–13 лет из всех залов. Взвешивание с 9:00.', ymd: ahead(20), time: '10:00', hours: 5, gym: 'dvorets', dir: 'bjj', coach: 'savelyev', by: 'savelyev' },
        { key: 'club-meetup', title: 'Клубная встреча: итоги сезона', description: 'Награждаем самых преданных учеников, рассказываем о планах. Чай и пицца.', ymd: ahead(25), time: '19:00', hours: 2, gym: 'dvorets', dir: null, coach: null, by: 'owner' },
    ]
    for (const e of eventDefs) {
        const startAt = at(e.ymd, e.time)
        plan.events.push({
            id: demoUuid(`event:${e.key}`),
            workspaceId,
            title: e.title,
            description: e.description,
            link: e.link ?? null,
            startAt,
            endAt: new Date(startAt.getTime() + e.hours * 60 * 60 * 1000),
            timezone: tz,
            gymId: gymId(e.gym),
            directionId: e.dir ? dirId(e.dir) : null,
            coachId: e.coach ? staffId(e.coach) : null,
            createdById: staffId(e.by),
            createdAt: at(addDaysYmd(e.ymd, -14) < today ? addDaysYmd(e.ymd, -14) : ago(1), '11:00'),
        })
    }
    const openMatId = demoUuid('event:openmat-past')
    const openMatStart = at(prevSat, '14:00')
    plan.sessions.push({
        id: demoUuid('session:openmat-past'),
        workspaceId,
        workspaceEventId: openMatId,
        occurrenceKey: eventOccurrenceKey(openMatId),
        title: 'Open mat БЖЖ',
        startAt: openMatStart,
        timezone: tz,
        coachId: staffId('savelyev'),
        createdById: staffId('savelyev'),
        createdAt: openMatStart,
    })
    members
        .filter(
            (p) =>
                p.kind === 'adult' &&
                p.groups.some((g) => groupDef(g.key).dir === 'bjj') &&
                (!p.stopYmd || p.stopYmd > prevSat),
        )
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 9)
        .forEach((p) => recordVisit(p, demoUuid('session:openmat-past'), staffId('savelyev'), openMatStart, null))

    // ---- personal trainings ----------------------------------------------------------
    for (const c of ['savelyev', 'reshetyuk', 'starokorov'] as StaffKey[]) {
        plan.ptCoaches.push({ workspaceId, userId: staffId(c), createdAt: at(ago(60), '12:00') })
    }
    const mmaPerson = members.find((p) => !fixedPeople.has(p) && p.archetype === 'regular' && p.groups.some((g) => g.key === 'rysMma'))!
    const muayPerson = members.find((p) => !fixedPeople.has(p) && p.archetype === 'regular' && p.groups.some((g) => g.key === 'svMuay'))!
    const declinedPerson = members.find((p) => !fixedPeople.has(p) && p.archetype === 'casual')!
    const ptPast = demoUuid('pt:past')
    const ptPastStart = at(ago(6), '11:00')
    const ptNext = demoUuid('pt:next')
    const ptNextStart = at(ahead(3), '11:00')
    const ptSession = (requestId: string, startAt: Date, coach: StaffKey) => {
        const id = demoUuid(`session:${requestId}`)
        plan.sessions.push({
            id,
            workspaceId,
            sessionDate: ymdToDbDate(localDateInTz(startAt, tz)),
            occurrenceKey: personalOccurrenceKey(requestId),
            title: 'Персональная тренировка',
            startAt,
            timezone: tz,
            coachId: staffId(coach),
            createdById: staffId(coach),
            isPersonal: true,
            createdAt: new Date(startAt.getTime() - 3 * DAY_MS),
        })
        return id
    }
    const ptPastSession = ptSession(ptPast, ptPastStart, 'reshetyuk')
    recordVisit(student, ptPastSession, staffId('reshetyuk'), ptPastStart, null)
    const ptNextSession = ptSession(ptNext, ptNextStart, 'savelyev')
    const ptRows: {
        id: string
        member: Person
        coach: StaffKey
        status: 'PENDING_COACH' | 'PENDING_MEMBER' | 'CONFIRMED' | 'DECLINED'
        memberComment: string
        coachComment?: string
        options: { startAt: Date; by: 'member' | 'coach' }[]
        confirmed?: { startAt: Date; sessionId: string }
        createdAt: Date
    }[] = [
        { id: ptPast, member: student, coach: 'reshetyuk', status: 'CONFIRMED', memberComment: 'Разобрать защиту от удушающих', options: [{ startAt: ptPastStart, by: 'member' }], confirmed: { startAt: ptPastStart, sessionId: ptPastSession }, createdAt: at(ago(10), '18:00') },
        { id: demoUuid('pt:pending-coach'), member: student, coach: 'reshetyuk', status: 'PENDING_COACH', memberComment: 'Подготовка к аттестации на синий пояс', options: [{ startAt: at(ahead(2), '13:00'), by: 'member' }, { startAt: at(ahead(4), '12:00'), by: 'member' }], createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
        { id: demoUuid('pt:pending-member'), member: mmaPerson, coach: 'starokorov', status: 'PENDING_MEMBER', memberComment: 'Готовлюсь к первому турниру', coachComment: 'Могу в эти дни утром', options: [{ startAt: at(ahead(1), '10:00'), by: 'coach' }, { startAt: at(ahead(4), '10:00'), by: 'coach' }], createdAt: at(ago(1), '20:00') },
        { id: ptNext, member: muayPerson, coach: 'savelyev', status: 'CONFIRMED', memberComment: 'Поставить технику ударов ногами', options: [{ startAt: ptNextStart, by: 'coach' }], confirmed: { startAt: ptNextStart, sessionId: ptNextSession }, createdAt: at(ago(2), '12:00') },
        { id: demoUuid('pt:declined'), member: declinedPerson, coach: 'starokorov', status: 'DECLINED', memberComment: 'Хочу индивидуально раз в неделю', coachComment: 'В эти дни я на сборах — давайте через две недели', options: [{ startAt: at(ahead(2), '09:00'), by: 'member' }], createdAt: at(ago(4), '09:00') },
    ]
    for (const r of ptRows) {
        plan.ptRequests.push({
            id: r.id,
            workspaceId,
            memberId: r.member.id,
            coachId: staffId(r.coach),
            // Персональные тренировки Савельева — в Северске.
            gymId: gymId(r.coach === 'savelyev' ? 'seversk' : r.coach === 'starokorov' ? 'rys' : 'yupiter'),
            timezone: tz,
            status: r.status,
            memberComment: r.memberComment,
            coachComment: r.coachComment ?? null,
            closedByRole: r.status === 'DECLINED' ? 'coach' : null,
            confirmedStartAt: r.confirmed?.startAt ?? null,
            confirmedDurationMin: r.confirmed ? 60 : null,
            sessionId: r.confirmed?.sessionId ?? null,
            createdAt: r.createdAt,
        })
        for (const o of r.options) {
            plan.ptOptions.push({ requestId: r.id, startAt: o.startAt, durationMin: 60, proposedBy: o.by, createdAt: r.createdAt })
        }
    }

    // ---- drop-in bookings ahead ------------------------------------------------------
    const book = (p: Person, g: GroupKey, slot: number) => {
        const ymd = nextDow(groupDef(g).slots[slot][0])
        plan.dropIns.push({
            workspaceId,
            userId: p.id,
            groupId: groupId(g),
            slotId: slotId(g, slot),
            sessionDate: ymdToDbDate(ymd),
            occurrenceKey: scheduledOccurrenceKey(slotId(g, slot), ymd),
            createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
        })
    }
    book(student, 'yuBjj', 0)
    members
        .filter(
            (p) =>
                !fixedPeople.has(p) &&
                p.archetype === 'regular' &&
                p.groups.length === 1 &&
                p.groups[0].key === 'yuBjj' &&
                !debtors.includes(p) &&
                !frozen.includes(p),
        )
        .slice(0, 2)
        .forEach((p) => book(p, 'shBjjEvening', 2))

    // ---- announcements -----------------------------------------------------------------
    const announce = (
        by: StaffKey,
        title: string,
        body: string,
        daysAgo: number | null,
        extra: { pinned?: boolean; dir?: DirKey; expiring?: boolean } = {},
    ) =>
        plan.announcements.push({
            workspaceId,
            authorId: staffId(by),
            title,
            body,
            pinned: extra.pinned ?? false,
            audience: extra.expiring ? 'EXPIRING' : 'ALL',
            directionId: extra.dir ? dirId(extra.dir) : null,
            publishedAt: daysAgo === null ? null : at(ago(daysAgo), '10:00'),
            createdAt: at(ago(daysAgo ?? 0), '09:30'),
        })
    announce('owner', 'Тайский бокс теперь и в Северске', 'Группа «Тайский бокс Взрослые» в СК «Центр тайского бокса», ул. Транспортная, 32. Персональные тренировки — по записи в приложении.', 20, { pinned: true })
    announce('admin', 'Продление и заморозка — в приложении', 'Абонемент можно продлить и заморозить прямо в приложении: раздел «Абонемент». Заявку на заморозку рассмотрим в течение дня.', 6)
    announce('admin', 'Ваш абонемент скоро закончится', 'Продлите абонемент до конца недели — и следующая неделя тренировок пройдёт без перерыва. Скидка 5% при продлении в день окончания.', 2, { expiring: true })
    announce('reshetyuk', `Аттестация на синие пояса — ${nextGradingYmd.split('-').reverse().slice(0, 2).join('.')}`, 'Список кандидатов — в разделе «Пояса». Готовность считается по посещениям: проверьте, сколько осталось.', 3, { dir: 'bjj', pinned: true })
    announce('savelyev', 'Open mat по субботам', 'Каждую субботу в 17:00 во «Дворце спорта» — свободные спарринги для всех залов. Приводите друзей: первое занятие бесплатно.', 12, { dir: 'bjj' })
    announce('starokorov', 'Спарринг-день в «Белой рыси»', 'Нужны перчатки 16 oz, капа и бинты. Новичкам — только технические раунды.', 1, { dir: 'mma' })
    announce('savelyev', 'Северск: купите бинты и капу', 'С 1 числа без бинтов и капы к парным работам не допускаем.', 8, { dir: 'muay' })
    announce('savelyev', 'Запись на детский турнир — до пятницы', 'Для всех детских групп. Взвешивание в день турнира с 9:00, нужна медицинская справка и страховка.', 4, { dir: 'bjj' })
    announce('admin', 'Абонемент — 30 дней с первой тренировки', 'Купили заранее — срок пойдёт с первого занятия. Заморозку и отметку оплаты делает тренер вашей группы.', 15)
    announce('owner', 'Новогоднее расписание', 'Черновик — опубликуем ближе к праздникам.', null)

    // ---- courses (video placeholders) ------------------------------------------------------
    COURSES.forEach((c, ci) => {
        const courseId = demoUuid(`course:${c.key}`)
        plan.courses.push({
            id: courseId,
            workspaceId,
            title: c.title,
            slug: c.key,
            description: c.description,
            level: c.level,
            publishedAt: at(ago(90 - ci * 9), '10:00'),
            createdAt: at(ago(95 - ci * 9), '10:00'),
        })
        plan.courseAudiences.push({ courseId, kind: 'DIRECTION', directionId: dirId(c.dir) })
        if (c.rankGate) {
            plan.courseAudiences.push({
                courseId,
                kind: 'RANK',
                rankLevelId: levelId(c.rankGate.ladder, c.rankGate.order),
            })
        }
        let order = 0
        c.chapters.forEach(([title, lessons], chi) => {
            const chapterId = demoUuid(`chapter:${c.key}:${chi}`)
            plan.chapters.push({ id: chapterId, courseId, title, order: chi })
            lessons.forEach((lesson, li) => {
                const videoId = demoUuid(`video:${c.key}:${chi}:${li}`)
                // No media in the demo: «processing» renders as «видео
                // обрабатывается» everywhere and never offers a broken player.
                plan.videos.push({
                    id: videoId,
                    workspaceId,
                    title: lesson,
                    description: `${c.title} — ${title}`,
                    url: '',
                    status: 'processing',
                    createdAt: at(ago(95 - ci * 9), '10:00'),
                })
                plan.courseVideos.push({ courseId, videoId, order: order++, lessonTitle: lesson, chapterId })
            })
        })
    })

    // ---- the rest: retention note, journal, audit trail ---------------------------------
    const contacted = members.find((p) => p.archetype === 'declining' && p.kind === 'adult')
    if (contacted) {
        plan.retentionContacts.push({
            workspaceId,
            userId: contacted.id,
            contactedById: adminId,
            reason: 'call',
            signals: ['declining'],
            note: 'Позвонили: был в командировке, обещал вернуться на следующей неделе',
            createdAt: at(ago(4), '15:00'),
        })
    }
    // A call that went nowhere three weeks ago (back on the list), and one the
    // coach made yesterday (hidden for two weeks).
    const unreached = members.find((p) => p.archetype === 'absent' && p.kind === 'adult')
    if (unreached) {
        plan.retentionContacts.push({
            workspaceId,
            userId: unreached.id,
            contactedById: adminId,
            reason: 'call',
            signals: ['absent'],
            note: 'Не взял трубку, написали в WhatsApp',
            createdAt: at(ago(18), '12:30'),
        })
    }
    const promised = members.find((p) => p.archetype === 'lapsed' && p.kind === 'adult')
    if (promised) {
        plan.retentionContacts.push({
            workspaceId,
            userId: promised.id,
            contactedById: staffId('reshetyuk'),
            reason: 'call',
            signals: ['lapsed', 'absent'],
            note: 'Продлит абонемент после зарплаты',
            createdAt: at(ago(1), '19:40'),
        })
    }
    const journal: [number, string][] = [
        [2, 'Отработали выходы из бокового. Получается мост, но забываю про локоть.'],
        [5, 'Спарринг с Дмитрием: дважды попал в треугольник. Разобрать защиту.'],
        [9, 'ММА: связка джеб-кросс-проход. Устал к третьему раунду — добавить кардио.'],
        [16, 'Первый раз свипнул из закрытого гарда в спарринге!'],
    ]
    for (const [d, body] of journal) {
        plan.journal.push({ workspaceId, userId: student.id, entryDate: ymdToDbDate(ago(d)), body, createdAt: at(ago(d), '22:00') })
    }
    const audit = (
        action: string,
        targetType: string,
        targetId: string,
        actor: StaffKey,
        createdAt: Date,
        metadata?: Prisma.InputJsonValue,
    ) =>
        plan.auditEvents.push({
            workspaceId,
            actorId: staffId(actor),
            actorEmail: STAFF.find((s) => s.key === actor)!.email,
            action,
            targetType,
            targetId,
            metadata,
            createdAt,
        })
    persons
        .flatMap((p) => p.subs.filter((s) => s.soldAt <= now).map((s) => ({ p, s })))
        .sort((a, b) => b.s.soldAt.getTime() - a.s.soldAt.getTime())
        .slice(0, 6)
        .forEach(({ p, s }) =>
            audit('member.assignSubscription', 'member', p.id, 'admin', s.soldAt, {
                planName: s.tariff.name,
            }),
        )
    audit('event.create', 'event', demoUuid('event:club-meetup'), 'owner', at(ago(1), '11:00'), {
        title: 'Клубная встреча: итоги сезона',
    })

    return plan
}
