import {
    isoDayOfWeek,
    localDateInTz,
    scheduledOccurrenceKey,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import { GUARDIAN_CONSENT_VERSION } from '../../features/dependents/dependents-utils'
import { defaultAchievementRows } from '../../features/manage-achievements/default-achievement-rows'
import type { Prisma } from '../../infrastructure/prisma'
import { cap, countNoun, fromFirstSession, vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import { FIRST_VISIT_AUTO_START_DAYS } from '../subscriptions/first-visit-start'
import { addDaysYmd, ymdToDbDate } from '../subscriptions/freeze-dates'
import { defaultFeatureColumnsFor } from '../workspace/feature-flags'
import {
    BERKUT_ACCOUNTS,
    BERKUT_CLUB_KEY,
    BERKUT_CLUB_NAME,
    BERKUT_EMAIL_DOMAIN,
    BERKUT_JOIN_CODE,
} from './berkut-demo.accounts'
import { type DemoAccountKey, demoAccountName } from './demo-accounts'
import { FEMALE_NAMES, MALE_NAMES, SURNAMES, femaleSurname, translit } from './demo-club.catalog'
import {
    type DemoClubPlan,
    type DemoPlanInput,
    type DemoRoleName,
    demoPaymentMethod,
    demoUuid,
} from './demo-club.plan'
import {
    DEMO_ORG_ID,
    DEMO_ORG_JOINED_DAYS_AGO,
    DEMO_ORG_TEMPLATES,
    type DemoOrgTemplateKey,
    demoOrgTemplateId,
    demoOrgTemplateLevelId,
} from './demo-organization'

// The demo club «Беркут» (docs/demo.md, «Федерация»): the second member of the
// demo federation next to ACADEMY, built the way «Ритм» is (ritm-demo.plan.ts)
// but smaller — one hall, one direction, four groups, ~90 students (25 of them
// children with their parents), 220 days of visits and abonements, and rank
// ladders copied from the federation's standards (templateId / templateVersion
// / templateLevelId, demo-organization.ts). The code is sport-agnostic: the
// club's type picks the vocabulary, the content (names, levels) is data.
// Deterministic: the same club-local day always yields the same rows, ids and
// counts; every date is relative to today. Pure — demo-club.writer.ts inserts
// the rows; seedDemoOrganization links the club to the federation.

const DAY_MS = 24 * 60 * 60 * 1000
const SEED = 20_261_126
export const BERKUT_HISTORY_DAYS = 220
const FAR_FUTURE_DAYS = 5 * 365
const ADULTS = 64
const KIDS = 25
// Adults who came during the history and left: the club removed them, their
// visits and abonements stay (no member), so the cohorts count them.
const LEAVERS = 18
const RENEW_AHEAD_SHARE = 0.85

const berkutId = (name: string) => demoUuid(`berkut:${name}`)

type StaffKey = 'owner' | 'martynov' | 'egorova'
type GroupKey = 'adultsMorning' | 'adultsEvening' | 'kids' | 'teens'
type TariffKey = 'trial' | 'pack8' | 'pack12' | 'kids8'
type Archetype = 'regular' | 'newcomer' | 'lapsed' | 'declining' | 'trialOnly'

type GroupDef = {
    key: GroupKey
    name: string
    coach: StaffKey
    kind: 'adult' | 'kid'
    // Which federation standard the group's ladder was copied from.
    ladder: DemoOrgTemplateKey
    // [ISO weekday, start, minutes]
    slots: [number, string, number][]
}

type TariffDef = {
    key: TariffKey
    name: string
    description: string
    price: number
    classes: number
    days: number
    isFreeTrial?: boolean
}

type Sub = {
    id: string
    tariff: TariffDef
    soldAt: Date
    startAt: Date
    endAt: Date
    remaining: number
    isPaid: boolean
    pending?: boolean
}

type Person = {
    idx: number
    id: string
    firstname: string
    lastname: string
    email: string | null
    kind: 'adult' | 'kid'
    dob: string
    group: GroupKey
    archetype: Archetype
    // First day in the club; for long-standing members before the history.
    joinYmd: string
    stopYmd: string | null
    left?: boolean
    target: number
    subs: Sub[]
    visits: number
}

const VOCABULARY = vocabularyForWorkspaceType('GRAPPLING')
const FROM_FIRST = `30 дней ${fromFirstSession(VOCABULARY)}`

const GYM = { name: 'Спортзал «Олимп»', address: 'Томск, ул. Вымышленная, 7 (демо)' }
const DIRECTION = { name: 'БЖЖ', color: '#0f766e', icon: '🥋' }

const STAFF: readonly {
    key: StaffKey
    role: DemoRoleName
    account?: DemoAccountKey
    firstname: string
    lastname: string
    description: string
}[] = [
    { key: 'owner', role: 'admin', account: 'owner', firstname: 'Игорь', lastname: 'Ветров', description: `Основатель клуба, ${VOCABULARY.headCoach.nom}` },
    { key: 'martynov', role: 'coach', account: 'coach', firstname: 'Алексей', lastname: 'Мартынов', description: `${cap(VOCABULARY.coach.nom)}: взрослые утром и подростки` },
    { key: 'egorova', role: 'coach', firstname: 'Ксения', lastname: 'Егорова', description: `${cap(VOCABULARY.coach.nom)} детской группы` },
]

const GROUPS: readonly GroupDef[] = [
    { key: 'adultsMorning', name: 'Взрослые · утро', coach: 'martynov', kind: 'adult', ladder: 'adults', slots: [[2, '07:30', 75], [4, '07:30', 75], [6, '10:00', 90]] },
    { key: 'adultsEvening', name: 'Взрослые · вечер', coach: 'owner', kind: 'adult', ladder: 'adults', slots: [[1, '19:30', 90], [3, '19:30', 90], [5, '19:30', 90]] },
    { key: 'kids', name: 'Дети 7–10', coach: 'egorova', kind: 'kid', ladder: 'kids', slots: [[2, '17:00', 60], [4, '17:00', 60]] },
    { key: 'teens', name: 'Подростки', coach: 'martynov', kind: 'kid', ladder: 'kids', slots: [[1, '17:30', 75], [3, '17:30', 75], [6, '12:00', 75]] },
]

const TARIFFS: readonly TariffDef[] = [
    {
        key: 'trial',
        name: `Пробная ${VOCABULARY.session.nom}`,
        description: `Первая ${VOCABULARY.session.nom} бесплатно — в любой группе клуба`,
        price: 0,
        classes: 1,
        days: 14,
        isFreeTrial: true,
    },
    { key: 'pack8', name: countNoun(8, VOCABULARY.session), description: `Взрослые группы, ${FROM_FIRST}`, price: 4200, classes: 8, days: 30 },
    { key: 'pack12', name: countNoun(12, VOCABULARY.session), description: `Взрослые группы, ${FROM_FIRST}. Самый выгодный`, price: 5400, classes: 12, days: 30 },
    { key: 'kids8', name: `${countNoun(8, VOCABULARY.session)} · дети`, description: `Дети и подростки, ${FROM_FIRST}`, price: 3600, classes: 8, days: 30 },
]

// mulberry32, as in demo-club.plan.ts.
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

const shuffle = <T>(list: readonly T[], r: () => number): T[] => {
    const out = [...list]
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
}

// Placeholder numbers from the +7 900 3xx-xx-xx block (ACADEMY 1xx, «Ритм»
// 2xx), a bijection mod 10^6 so no two people share one.
const demoPhone = (n: number) => `+79003${String((n * 7919 + 104_729) % 1_000_000).padStart(6, '0')}`
const PARENT_PHONE_OFFSET = 10_000

export const buildBerkutDemoPlan = (input: DemoPlanInput): DemoClubPlan => {
    const rnd = makeRng(SEED)
    const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]

    const { now } = input
    const tz = input.timezone
    const today = localDateInTz(now, tz)
    const ago = (days: number) => addDaysYmd(today, -days)
    const at = (ymd: string, hm: string) => wallClockToUtc(`${ymd}T${hm}`, tz)
    const dow = (ymd: string) => isoDayOfWeek(ymdToDbDate(ymd))
    const historyStart = ago(BERKUT_HISTORY_DAYS)
    const far = new Date(now.getTime() + FAR_FUTURE_DAYS * DAY_MS)

    const workspaceId = berkutId('workspace')
    const plan: DemoClubPlan = {
        workspaceId,
        workspace: {} as Prisma.WorkspaceCreateManyInput,
        joinCode: BERKUT_JOIN_CODE,
        accountUserIds: {},
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
        eventRegistrations: [],
        subscriptions: [],
        refunds: [],
        discounts: [],
        subscriptionDirections: [],
        sessions: [],
        records: [],
        classOccurrences: [],
        classBookings: [],
        freezeRequests: [],
        liveFreezes: [],
        announcements: [],
        announcementGroups: [],
        achievements: [],
        videos: [],
        courses: [],
        chapters: [],
        courseVideos: [],
        courseAudiences: [],
        ptCoaches: [],
        ptRequests: [],
        ptOptions: [],
        reviewClips: [],
        videoReviews: [],
        dropIns: [],
        classSubstitutions: [],
        retentionContacts: [],
        journal: [],
        auditEvents: [],
        aiTokens: [],
        aiChatAcceptances: [],
        aiChatConversations: [],
        aiChatUsages: [],
        clubMessages: [],
        clubMessageRecipients: [],
        notifications: [],
        coachRates: [],
        payrollAdjustments: [],
        payrollClose: null,
        leads: [],
    }

    // ---- ids ---------------------------------------------------------------
    const staffId = (k: StaffKey) => berkutId(`staff:${k}`)
    const gymId = berkutId('gym')
    const dirId = berkutId('direction')
    const groupId = (k: GroupKey) => berkutId(`group:${k}`)
    const slotId = (k: GroupKey, i: number) => berkutId(`slot:${k}:${i}`)
    const tariffId = (k: TariffKey) => berkutId(`plan:${k}`)
    const ladderId = (k: DemoOrgTemplateKey) => berkutId(`ladder:${k}`)
    const levelId = (k: DemoOrgTemplateKey, order: number) => berkutId(`level:${k}:${order}`)
    const groupDef = (k: GroupKey) => GROUPS.find((g) => g.key === k) as GroupDef
    const tariffDef = (k: TariffKey) => TARIFFS.find((t) => t.key === k) as TariffDef
    const account = (k: DemoAccountKey) => BERKUT_ACCOUNTS.find((a) => a.key === k)!
    const ownerId = staffId('owner')

    // ---- club ----------------------------------------------------------------
    const clubCreatedYmd = ago(BERKUT_HISTORY_DAYS + 20)
    plan.workspace = {
        id: workspaceId,
        key: BERKUT_CLUB_KEY,
        name: BERKUT_CLUB_NAME,
        type: 'GRAPPLING',
        isActive: true,
        isDemo: true,
        ownerId,
        timezone: tz,
        city: 'Томск',
        leaderboardEnabled: true,
        guestVisitsEnabled: false,
        pdOperatorName: 'ИП Ветров Игорь Сергеевич (демо)',
        pdOperatorAddress: GYM.address,
        ...defaultFeatureColumnsFor('GRAPPLING'),
        // Placeholders: never a real number or link in the seed.
        aboutContacts: [{ label: 'Администратор клуба', phone: '+7 900 000-00-31' }],
        aboutRules: `Абонемент действует ${FROM_FIRST}. Пробная ${VOCABULARY.session.nom} — бесплатно, в любой группе.`,
        aboutUpdatedAt: at(ago(40), '12:00'),
        publicDescription: 'Клуб единоборств: взрослые группы утром и вечером, дети с 7 лет и подростки.',
        createdAt: at(clubCreatedYmd, '10:00'),
    }
    plan.billing = {
        workspaceId,
        status: 'ACTIVE',
        trialEndsAt: null,
        currentPeriodEnd: far,
        freeUntil: far,
        setupFeeWaived: true,
        paidTierCode: 'club',
        createdAt: at(clubCreatedYmd, '12:00'),
        convertedAt: at(addDaysYmd(clubCreatedYmd, 14), '12:00'),
        autopayEnabled: false,
        notes: 'Демо-клуб федерации для показов: подписка ClubSpace бесплатно (docs/demo.md)',
    }
    plan.moduleEntitlements = (['VIDEO', 'ONLINE_PAYMENTS', 'BRANDED_APP'] as const).map((module) => ({
        workspaceId,
        module,
        mode: 'COMP' as const,
        compUntil: far,
    }))
    const editionYmd = [input.legal.offerVersion, input.legal.dpaVersion].sort().at(-1) ?? today
    const editionAt = /^\d{4}-\d{2}-\d{2}$/.test(editionYmd) ? at(editionYmd, '12:00') : now
    plan.legalAcceptance = {
        workspaceId,
        userId: ownerId,
        userEmail: account('owner').email,
        userName: demoAccountName(account('owner')),
        offerVersion: input.legal.offerVersion,
        dpaVersion: input.legal.dpaVersion,
        source: 'CONSOLE',
        acceptedAt: editionAt < now ? editionAt : now,
    }
    plan.gyms.push({ id: gymId, workspaceId, name: GYM.name, address: GYM.address, createdAt: at(clubCreatedYmd, '10:00') })
    plan.directions.push({ id: dirId, workspaceId, name: DIRECTION.name, color: DIRECTION.color, icon: DIRECTION.icon, order: 0 })
    plan.achievements.push(...defaultAchievementRows(workspaceId, dirId, VOCABULARY))
    plan.achievements.push(...defaultAchievementRows(workspaceId, null, VOCABULARY))
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
            startsOnFirstVisit: !t.isFreeTrial,
        })
        plan.planDirections.push({ planId: tariffId(t.key), directionId: dirId })
    }

    // ---- ladders: copies of the federation standards -------------------------
    // Taken when the club joined the federation; the copy is the club's own.
    const adoptedYmd = ago(DEMO_ORG_JOINED_DAYS_AGO.berkut - 2)
    DEMO_ORG_TEMPLATES.forEach((t, order) => {
        plan.ladders.push({
            id: ladderId(t.key),
            workspaceId,
            name: t.name,
            audience: t.audience,
            order,
            directionId: dirId,
            templateId: demoOrgTemplateId(t.key),
            templateVersion: t.version,
            createdAt: at(adoptedYmd, '12:00'),
        })
        t.levels.forEach((lv, i) =>
            plan.levels.push({
                id: levelId(t.key, i),
                ladderId: ladderId(t.key),
                name: lv.name,
                order: i,
                color: lv.color,
                maxStripes: t.maxStripes,
                requirements: lv.requirements ?? null,
                minVisits: lv.minVisits ?? null,
                minWeeks: lv.minWeeks ?? null,
                templateLevelId: demoOrgTemplateLevelId(t.key, i),
            }),
        )
    })

    // ---- people ------------------------------------------------------------
    const addUser = (p: {
        id: string
        email: string | null
        firstname: string
        lastname: string
        createdYmd: string
        dob?: string | null
        description?: string
        lastSeenYmd?: string
        phone?: string | null
    }) => {
        plan.users.push({
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
        if (p.email) {
            plan.consents.push({
                userId: p.id,
                kind: 'PERSONAL_DATA',
                version: input.personalDataConsentVersion,
                acceptedAt: at(p.createdYmd, '12:00'),
            })
        }
    }

    STAFF.forEach((s, i) => {
        const since = s.key === 'owner' ? clubCreatedYmd : addDaysYmd(clubCreatedYmd, 7 + i * 10)
        addUser({
            id: staffId(s.key),
            email: s.account ? account(s.account).email : `${translit(s.lastname)}@${BERKUT_EMAIL_DOMAIN}`,
            firstname: s.firstname,
            lastname: s.lastname,
            createdYmd: since,
            description: s.description,
            phone: demoPhone(900 + i),
        })
        plan.members.push({
            role: s.role,
            data: { userId: staffId(s.key), workspaceId, status: 'ACTIVE', createdAt: at(since, '12:00'), lastSeenAt: at(today, '09:00') },
        })
        if (s.account) plan.accountUserIds[s.account] = staffId(s.key)
    })

    const usedNames = new Set<string>(STAFF.map((s) => `${s.firstname} ${s.lastname}`))
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
    const persons: Person[] = []
    const addPerson = (p: Omit<Person, 'idx' | 'id' | 'subs' | 'visits' | 'email'>) => {
        const idx = persons.length + 1
        const person: Person = {
            ...p,
            idx,
            id: berkutId(`person:${idx}`),
            email: p.kind === 'kid' ? null : `${translit(p.firstname)}.${translit(p.lastname)}.${idx}@${BERKUT_EMAIL_DOMAIN}`,
            subs: [],
            visits: 0,
        }
        persons.push(person)
        return person
    }

    // About one in ten in «Кто пропадает» on any day, the rest steady.
    const deck = (n: number, quotas: [Archetype, number][]) => {
        const cards = quotas.flatMap(([a, k]) => Array<Archetype>(k).fill(a))
        return shuffle([...cards, ...Array<Archetype>(n - cards.length).fill('regular')], rnd)
    }
    const adultDeck = deck(ADULTS, [['lapsed', 2], ['declining', 2], ['trialOnly', 1], ['newcomer', 7]])
    const kidDeck = deck(KIDS, [['declining', 1], ['newcomer', 3]])
    // A regular is past the newcomer's 90 days; some adults have trained for
    // years (their belts are older than the club's history in the app), a
    // child since six at the earliest.
    const joinFor = (a: Archetype, maxDays: number) =>
        a === 'newcomer' || a === 'trialOnly' ? ago(int(3, 60)) : ago(int(100, Math.max(120, maxDays)))
    for (let i = 0; i < ADULTS; i++) {
        const female = rnd() < 0.2
        const name = freshName(female)
        const archetype = adultDeck[i]
        addPerson({
            firstname: name.first,
            lastname: name.last,
            kind: 'adult',
            dob: ago(int(18, 45) * 365 + int(0, 364)),
            group: rnd() < 0.35 ? 'adultsMorning' : 'adultsEvening',
            archetype,
            joinYmd: joinFor(archetype, rnd() < 0.5 ? 500 : 2400),
            stopYmd: archetype === 'lapsed' ? ago(int(20, 45)) : null,
            target: archetype === 'declining' ? int(2, 3) : int(1, 3),
        })
    }
    for (let i = 0; i < KIDS; i++) {
        const female = rnd() < 0.3
        const name = freshName(female)
        const age = int(7, 15)
        const archetype = kidDeck[i]
        addPerson({
            firstname: name.first,
            lastname: name.last,
            kind: 'kid',
            dob: ago(age * 365 + int(0, 364)),
            group: age <= 10 ? 'kids' : 'teens',
            archetype,
            joinYmd: joinFor(archetype, (age - 6) * 365),
            stopYmd: null,
            target: 2,
        })
    }
    for (let i = 0; i < LEAVERS; i++) {
        const female = rnd() < 0.2
        const name = freshName(female)
        const joinYmd = ago(int(70, BERKUT_HISTORY_DAYS - 5))
        const weeks = rnd() < 0.25 ? 0 : int(4, 14)
        const stop = addDaysYmd(joinYmd, weeks === 0 ? 7 : weeks * 7)
        const latest = ago(int(42, 56))
        addPerson({
            firstname: name.first,
            lastname: name.last,
            kind: 'adult',
            dob: ago(int(18, 40) * 365 + int(0, 364)),
            group: rnd() < 0.35 ? 'adultsMorning' : 'adultsEvening',
            archetype: weeks === 0 ? 'trialOnly' : 'regular',
            joinYmd: joinYmd < latest ? joinYmd : latest,
            stopYmd: stop < latest ? stop : latest,
            left: true,
            target: int(1, 3),
        })
    }

    // ---- groups and schedule -----------------------------------------------
    for (const g of GROUPS) {
        plan.groups.push({
            id: groupId(g.key),
            workspaceId,
            name: g.name,
            gymId,
            directionId: dirId,
            coachId: staffId(g.coach),
            createdAt: at(clubCreatedYmd, '11:00'),
        })
        plan.groupCoaches.push({ groupId: groupId(g.key), userId: staffId(g.coach), role: 'primary' })
        g.slots.forEach(([dayOfWeek, startTime, durationMin], i) => {
            plan.slots.push({ id: slotId(g.key, i), groupId: groupId(g.key), dayOfWeek, startTime, durationMin })
        })
    }

    // ---- abonements and visits ---------------------------------------------
    const tariffFor = (p: Person): TariffDef =>
        p.kind === 'kid' ? tariffDef('kids8') : tariffDef(p.target >= 3 ? 'pack12' : 'pack8')
    const buy = (p: Person, t: TariffDef, ymd: string, classTime: string): Sub => {
        const [h, m] = classTime.split(':').map(Number)
        const soldAt = new Date(at(ymd, classTime).getTime() - (15 + ((h * 60 + m + p.idx) % 20)) * 60_000)
        const startAt = t.isFreeTrial ? soldAt : at(ymd, '00:00')
        const sub: Sub = {
            id: berkutId(`sub:${p.idx}:${p.subs.length}`),
            tariff: t,
            soldAt,
            startAt,
            endAt: t.isFreeTrial ? new Date(startAt.getTime() + t.days * DAY_MS) : at(addDaysYmd(ymd, t.days), '00:00'),
            remaining: t.classes,
            isPaid: true,
        }
        p.subs.push(sub)
        return sub
    }
    // Who was already a member when the history starts holds an abonement
    // bought up to a month before, partly used.
    for (const p of persons) {
        if (p.joinYmd >= historyStart || p.archetype === 'trialOnly') continue
        const startYmd = addDaysYmd(historyStart, -int(0, 27))
        const t = tariffFor(p)
        const s = buy(p, t, startYmd, '18:00')
        const usedWeeks = Math.round((Date.parse(historyStart) - Date.parse(startYmd)) / (7 * DAY_MS))
        s.remaining = Math.max(1, t.classes - usedWeeks * p.target)
    }
    const startPending = (s: Sub, ymd: string) => {
        const auto = addDaysYmd(localDateInTz(s.soldAt, tz), FIRST_VISIT_AUTO_START_DAYS)
        const from = auto < ymd ? auto : ymd
        s.pending = false
        s.startAt = at(from, '00:00')
        s.endAt = at(addDaysYmd(from, s.tariff.days), '00:00')
    }
    const covering = (p: Person, instant: Date, ymd: string): Sub | null => {
        const live = p.subs.find((s) => !s.pending && s.startAt <= instant && instant < s.endAt && s.remaining > 0)
        if (live) return live
        const next = p.subs.find((s) => s.pending && s.soldAt <= instant)
        if (!next) return null
        startPending(next, ymd)
        return next.endAt > instant ? next : covering(p, instant, ymd)
    }
    const habits = new Map<Person, Set<number>>()
    const habitOf = (p: Person) => {
        let set = habits.get(p)
        if (!set) {
            const slots = groupDef(p.group).slots.map((_, i) => i)
            const turn = p.idx % slots.length
            set = new Set([...slots.slice(turn), ...slots.slice(0, turn)].slice(0, p.target))
            habits.set(p, set)
        }
        return set
    }
    const chance = (p: Person, ymd: string, slot: number): number => {
        if (ymd < p.joinYmd || (p.stopYmd && ymd > p.stopYmd)) return 0
        if (p.archetype === 'trialOnly') return p.visits === 0 ? 0.95 : 0
        const base = habitOf(p).has(slot) ? 0.85 : 0.05
        if (p.archetype === 'declining' && ymd >= ago(21)) return base * 0.1
        return base
    }
    const renewsAhead = (p: Person, sub: Sub, startAt: Date) =>
        !p.left &&
        (p.archetype === 'regular' || p.archetype === 'newcomer') &&
        !sub.tariff.isFreeTrial &&
        !p.subs.some((s) => s.pending) &&
        (sub.remaining === 0 || sub.endAt.getTime() - startAt.getTime() < 7 * DAY_MS) &&
        rnd() < RENEW_AHEAD_SHARE
    const lastVisit = new Map<string, string>()

    for (let ymd = historyStart; ymd < today; ymd = addDaysYmd(ymd, 1)) {
        const weekday = dow(ymd)
        for (const g of GROUPS) {
            g.slots.forEach(([day, time, minutes], i) => {
                if (day !== weekday) return
                const startAt = at(ymd, time)
                const sessionId = berkutId(`session:${g.key}:${i}:${ymd}`)
                const before = plan.records.length
                for (const p of persons) {
                    if (p.group !== g.key || rnd() >= chance(p, ymd, i)) continue
                    let sub = covering(p, startAt, ymd)
                    if (!sub) {
                        const first = p.subs.length === 0 && (p.archetype === 'newcomer' || p.archetype === 'trialOnly' || !!p.left)
                        sub = buy(p, first ? tariffDef('trial') : tariffFor(p), ymd, time)
                    }
                    sub.remaining -= 1
                    p.visits += 1
                    plan.records.push({
                        sessionId,
                        workspaceId,
                        userId: p.id,
                        markedById: staffId(g.coach),
                        markedAt: new Date(startAt.getTime() + int(3, 15) * 60_000),
                        usedSubscriptionId: sub.id,
                        consumedSubscriptionId: sub.id,
                    })
                    lastVisit.set(p.id, ymd)
                    if (renewsAhead(p, sub, startAt)) {
                        const next = buy(p, tariffFor(p), ymd, time)
                        next.soldAt = new Date(startAt.getTime() + (minutes + 5 + (p.idx % 10)) * 60_000)
                        next.pending = true
                    }
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
    // Bought ahead and not started by today: started by itself if the sale
    // is two weeks old, otherwise waiting, with the provisional access end.
    for (const p of persons) {
        for (const s of p.subs) {
            if (!s.pending) continue
            const saleYmd = localDateInTz(s.soldAt, tz)
            if (addDaysYmd(saleYmd, FIRST_VISIT_AUTO_START_DAYS) <= today) startPending(s, today)
            else s.endAt = at(addDaysYmd(saleYmd, FIRST_VISIT_AUTO_START_DAYS + s.tariff.days), '00:00')
        }
    }
    const liveSub = (p: Person) => p.subs.find((s) => !s.pending && s.startAt <= now && now < s.endAt) ?? null
    // Two pay at the next visit — «Долги» has someone to show.
    persons
        .filter((p) => !p.left && p.archetype === 'regular' && p.kind === 'adult')
        .slice(0, 2)
        .forEach((p) => {
            const last = p.subs.at(-1)
            if (last && last.tariff.price > 0) last.isPaid = false
        })
    // The rest of those whose abonement ends soon renew in the last days.
    for (const p of persons) {
        if (p.left || p.archetype !== 'regular' || p.subs.some((s) => s.pending)) continue
        const live = liveSub(p)
        if (!live || live.tariff.isFreeTrial || rnd() >= 0.8) continue
        const daysLeft = (live.endAt.getTime() - now.getTime()) / DAY_MS
        if (daysLeft > 7 && live.remaining > 0) continue
        const drawn = ago(int(1, 3))
        const last = lastVisit.get(p.id) ?? ''
        const saleYmd = drawn > last ? drawn : last
        const next = buy(p, live.tariff, saleYmd, '21:30')
        next.pending = true
        next.endAt = at(addDaysYmd(saleYmd, FIRST_VISIT_AUTO_START_DAYS + live.tariff.days), '00:00')
    }

    for (const p of persons) {
        p.subs.forEach((s, i) => {
            const renewed = i < p.subs.length - 1
            plan.subscriptions.push({
                id: s.id,
                workspaceId,
                planId: tariffId(s.tariff.key),
                status: s.remaining === 0 && renewed ? 'EXPIRED' : 'ACTIVE',
                startDate: s.pending ? null : s.startAt,
                endDate: s.pending ? null : s.endAt,
                startsOnFirstVisit: !s.tariff.isFreeTrial,
                durationDays: s.tariff.days,
                amountPaid: s.tariff.price,
                listPrice: s.tariff.price,
                pricedById: ownerId,
                currency: 'RUB',
                isPaid: s.isPaid,
                paidAt: s.isPaid ? s.soldAt : null,
                paymentMethod: s.isPaid && s.tariff.price > 0 ? demoPaymentMethod(s.id) : null,
                markedPaidById: s.isPaid ? ownerId : null,
                classesTotal: s.tariff.classes,
                classesRemaining: s.remaining,
                workspaceMemberId: p.left ? null : berkutId(`member:${p.idx}`),
                userId: p.id,
                source: 'MANUAL',
                createdAt: s.soldAt,
            })
            plan.subscriptionDirections.push({ subscriptionId: s.id, directionId: dirId })
        })
    }

    // ---- members and families ------------------------------------------------
    for (const p of persons) {
        const seen = p.stopYmd ?? lastVisit.get(p.id) ?? p.joinYmd
        addUser({
            id: p.id,
            email: p.email,
            firstname: p.firstname,
            lastname: p.lastname,
            createdYmd: p.joinYmd,
            dob: p.dob,
            lastSeenYmd: seen,
            phone: p.kind === 'kid' ? null : demoPhone(p.idx),
        })
        if (p.left) continue
        plan.members.push({
            role: 'user',
            data: {
                id: berkutId(`member:${p.idx}`),
                userId: p.id,
                workspaceId,
                status: 'ACTIVE',
                accessUntil: p.subs.reduce<Date | null>((max, s) => (!max || s.endAt > max ? s.endAt : max), null),
                createdAt: at(p.joinYmd, '12:00'),
                lastSeenAt: at(seen, '20:00'),
                // A few members muted the club, as in a real one; nobody else
                // (demo e-mail is dropped at dispatch, generated students
                // have no devices) — the ACADEMY / «Ритм» rule.
                notificationsMuted: p.idx % 31 === 9,
            },
        })
        plan.groupMembers.push({ groupId: groupId(p.group), userId: p.id, joinedAt: at(p.joinYmd, '12:00') })
    }
    // Every child has a parent who confirmed the link (the federation consent
    // for a child is the parent's, seedDemoOrganization).
    for (const kid of persons.filter((p) => p.kind === 'kid')) {
        const female = rnd() < 0.7
        const base = kid.lastname.endsWith('а') ? kid.lastname.slice(0, -1) : kid.lastname
        const parentId = berkutId(`parent:${kid.idx}`)
        const first = pick(female ? FEMALE_NAMES : MALE_NAMES)
        addUser({
            id: parentId,
            email: `${translit(first)}.${translit(base)}.parent${kid.idx}@${BERKUT_EMAIL_DOMAIN}`,
            firstname: first,
            lastname: female ? femaleSurname(base) : base,
            createdYmd: kid.joinYmd,
            phone: demoPhone(PARENT_PHONE_OFFSET + kid.idx),
        })
        plan.guardianships.push({
            guardianId: parentId,
            dependentId: kid.id,
            relation: 'PARENT',
            invitedByWorkspaceId: workspaceId,
            invitedById: ownerId,
            consentAt: at(kid.joinYmd, '19:00'),
            consentVersion: GUARDIAN_CONSENT_VERSION,
            createdAt: at(kid.joinYmd, '18:00'),
        })
        plan.consents.push({
            userId: parentId,
            kind: 'DEPENDENT_DATA',
            version: GUARDIAN_CONSENT_VERSION,
            acceptedAt: at(kid.joinYmd, '19:00'),
            dependentId: kid.id,
        })
    }

    // ---- belts ----------------------------------------------------------------
    // Every member starts at the first level the day they joined and moves up
    // a stripe at a time, evenly over their years in the club; long-standing
    // adults hold higher levels. The last step is at least a few days old.
    const members = persons.filter((p) => !p.left)
    for (const p of members) {
        const g = groupDef(p.group)
        const t = DEMO_ORG_TEMPLATES.find((x) => x.key === g.ladder)!
        const steps = t.maxStripes + 1
        const tenure = Date.parse(today) - Date.parse(p.joinYmd)
        const years = tenure / (365 * DAY_MS)
        const isNew = p.archetype === 'newcomer' || p.archetype === 'trialOnly'
        // Levels reached: about one a year and a half for adults, a year for children.
        const perLevel = p.kind === 'kid' ? 1 : 1.6
        const level = isNew ? 0 : Math.min(t.levels.length - 2, Math.floor((years / perLevel) * (0.6 + rnd() * 0.6)))
        const stripes = isNew ? 0 : int(0, t.maxStripes)
        const total = level * steps + stripes
        const lastYmd = ago(int(5, 60))
        const span = Math.max(0, Date.parse(lastYmd) - Date.parse(p.joinYmd))
        for (let k = 0; k <= total; k++) {
            const ymd = k === 0 ? p.joinYmd : localDateInTz(new Date(Date.parse(p.joinYmd) + (span * k) / Math.max(1, total)), 'UTC')
            const lv = Math.floor(k / steps)
            const st = k % steps
            plan.promotions.push({
                id: berkutId(`promotion:${p.idx}:${k}`),
                workspaceId,
                userId: p.id,
                ladderId: ladderId(g.ladder),
                levelId: levelId(g.ladder, lv),
                stripes: st,
                note: null,
                awardedById: staffId(g.coach),
                awardedAt: at(ymd, '20:30'),
            })
        }
    }

    // ---- an announcement, the audit trail -----------------------------------
    plan.announcements.push({
        id: berkutId('announcement:tournament'),
        workspaceId,
        authorId: ownerId,
        title: 'Едем на турнир федерации',
        body: 'Записывайтесь в приложении: «События» → «События федерации». Тренер запишет тех, кто не успел.',
        pinned: true,
        audience: 'ALL',
        directionId: null,
        publishedAt: at(ago(3), '10:00'),
        createdAt: at(ago(3), '09:30'),
    })
    const audit = (
        action: string,
        targetType: string,
        targetId: string,
        createdAt: Date,
        metadata?: Prisma.InputJsonValue,
        organizationId: string | null = null,
    ) =>
        plan.auditEvents.push({
            workspaceId,
            organizationId,
            actorId: ownerId,
            actorEmail: account('owner').email,
            action,
            targetType,
            targetId,
            metadata,
            createdAt,
        })
    // The live shape (create-ladder-from-template handler).
    for (const t of DEMO_ORG_TEMPLATES) {
        audit('ladder.fromTemplate', 'rankLadder', ladderId(t.key), at(adoptedYmd, '12:00'), {
            name: t.name,
            clubName: BERKUT_CLUB_NAME,
            templateId: demoOrgTemplateId(t.key),
            templateName: t.name,
            templateVersion: t.version,
        }, DEMO_ORG_ID)
    }
    members
        .flatMap((p) => p.subs.filter((s) => s.soldAt <= now).map((s) => ({ p, s })))
        .sort((a, b) => b.s.soldAt.getTime() - a.s.soldAt.getTime())
        .slice(0, 5)
        .forEach(({ p, s }) => audit('member.assignSubscription', 'member', p.id, s.soldAt, { planName: s.tariff.name }))

    return plan
}
