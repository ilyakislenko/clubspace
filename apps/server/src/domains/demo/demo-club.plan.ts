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
import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import { AI_CHAT_DATA_WARNING } from '../ai-assistant/ai-chat-warning'
import { pseudonymFor } from '../ai-assistant/pseudonym'
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
    BOOKING_GROUP,
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
// at-risk list, renewals and «Аналитика» are computed by the product from
// these rows.

const DAY_MS = 24 * 60 * 60 * 1000
const SEED = 20_261_101
// A year and a week of visits and sales. «Аналитика» reads the club's past:
// cohorts by the month of the first visit (12 months), coach retention (who
// started over 90 days ago and was around 90-180 days ago), 26 weeks of
// schedule occupancy; and the risk rules read the first visit (a newcomer is
// under 90 days, a veteran over 365), so long-standing members need visits
// older than a year.
export const DEMO_HISTORY_DAYS = 371
// Renewals bought before the running abonement ends: the share, and how many
// days ahead (min, max). Most renew ahead, so in any fortnight only a few
// members' access is about to run out. At most 13 days: a bought abonement
// starts by itself FIRST_VISIT_AUTO_START_DAYS (14) after the sale.
const RENEW_AHEAD_SHARE = 0.95
const RENEW_AHEAD_DAYS: [number, number] = [10, FIRST_VISIT_AUTO_START_DAYS - 1]
const FAR_FUTURE_DAYS = 5 * 365
// People who trained during the year and left — the club removed them, their
// visits stay — per place in a group. Most leave within the first months, so
// the cohort curve falls; Решетюк's groups lose few, so «Тренеры» has a coach
// whose people stay.
const LEAVERS_PER_PLACE = 0.7
const TOP_COACH: StaffKey = 'reshetyuk'
const TOP_COACH_LEAVERS_PER_PLACE = 0
// Breaks in a regular's chain (a skipped month, see the chains below): the
// chance per abonement that started this many days ago (min, max). Together
// with those who left it puts the renewal share of «Аналитика → Прогноз»
// where a healthy martial-arts club is, around 80%.
const BREAK_SHARE = 0.2
const BREAK_WINDOW_DAYS: [number, number] = [75, 175]
// How strongly a slot draws its group against the group's other slots
// (default 1). The kids' weekday mornings in «Дворец спорта» and the Monday
// noon тайский in Северск are the weak slots of «Загрузка расписания».
const SLOT_PULL: Partial<Record<`${GroupKey}:${number}`, number>> = {
    'dvKidsSenior:0': 0.25,
    'dvKidsSenior:2': 0.25,
    'dvKidsSenior:4': 1.4,
    'svMuay:0': 0.45,
    'svMuay:2': 1.4,
    'shBjjEvening:2': 1.4,
}
// Saturday BJJ at «Шарики» is where «Юпитер» comes to roll: a guest's chance
// against their own class. The class runs over its roster — the «добавьте
// занятие» suggestion.
const SATURDAY_GUEST_SHARE = 0.8

export type DemoRoleName = 'admin' | 'head_coach' | 'coach' | 'user'

export type DemoPlanInput = {
    now: Date
    timezone: string
    personalDataConsentVersion: string
    legal: { offerVersion: string; dpaVersion: string }
    // The server secret the ИИ-ассистент pseudonyms are derived from
    // (environment.encryptionKey), so the demo conversation's m_… match a live one.
    pseudonymSecret: string
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
    // A club has only some of the roles (the studio has no admin account).
    accountUserIds: Partial<Record<DemoAccountKey, string>>
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
    // Places taken and the waitlist of a paid / limited event (a master class).
    eventRegistrations: Prisma.EventRegistrationCreateManyInput[]
    subscriptions: Prisma.SubscriptionCreateManyInput[]
    subscriptionDirections: Prisma.SubscriptionDirectionCreateManyInput[]
    sessions: Prisma.AttendanceSessionCreateManyInput[]
    records: Prisma.AttendanceRecordCreateManyInput[]
    // «Запись на занятие»: the booked classes of the BOOKING group and their
    // bookings (after subscriptions: a burn points at the pack it took).
    classOccurrences: Prisma.ClassOccurrenceCreateManyInput[]
    classBookings: Prisma.ClassBookingCreateManyInput[]
    freezeRequests: Prisma.SubscriptionFreezeRequestCreateManyInput[]
    // Applied through SubscriptionFreezeService after the rows exist, so the
    // end date and access window move exactly as for a club freeze.
    liveFreezes: DemoLiveFreeze[]
    announcements: Prisma.AnnouncementCreateManyInput[]
    announcementGroups: Prisma.AnnouncementGroupCreateManyInput[]
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
    // Замены: one approved (the head coach runs a БЖЖ class), one a coach's
    // request waiting for the group's coach.
    classSubstitutions: Prisma.ClassSubstitutionCreateManyInput[]
    retentionContacts: Prisma.MemberRetentionContactCreateManyInput[]
    journal: Prisma.TrainingJournalEntryCreateManyInput[]
    auditEvents: Prisma.AuditEventCreateManyInput[]
    // ИИ-ассистент (docs/mcp.md): tokens shown in «Интеграции». Their hashes
    // are not SHA-256 digests, so no secret ever opens the demo club.
    aiTokens: Prisma.AiAccessTokenCreateManyInput[]
    // ИИ-ассистент chat: the owner's acceptance that turns it on and a saved
    // conversation (features/ai-chat).
    aiChatAcceptances: Prisma.AiDataTransferAcceptanceCreateManyInput[]
    aiChatConversations: Prisma.AiChatConversationCreateManyInput[]
    // The question of that conversation counts against the monthly limit,
    // as a live one would — the counter reads «1 из N» next to it.
    aiChatUsages: Prisma.AiChatUsageCreateManyInput[]
}

// A stable uuid per logical entity: a reset recreates the club with the same
// ids, so an app holding the club, a child or a group keeps working.
export const demoUuid = (name: string): string => {
    const h = createHash('sha256').update(`clubspace-demo:${name}`).digest('hex')
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// How a sale recorded at the reception was paid: card at the club's
// terminal for about half, a transfer for a third, cash for the rest. Drawn
// from the sale's id, not the generator's noise, so the rest of the club stays
// as it is. Unpaid and free sales have no method («не указано» is only for
// rows from before payment methods were recorded).
export const demoPaymentMethod = (saleId: string): 'CASH' | 'TRANSFER' | 'CARD' => {
    const r = parseInt(createHash('sha256').update(`clubspace-demo:pay:${saleId}`).digest('hex').slice(0, 8), 16) % 20
    return r < 9 ? 'CARD' : r < 16 ? 'TRANSFER' : 'CASH'
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
    // Came to the free trial once and never bought.
    | 'trialOnly'
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
    // LEFT: trained, then the club removed them — visits and abonements stay,
    // no member row.
    status: 'ACTIVE' | 'INVITED' | 'LEFT'
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
        eventRegistrations: [],
        subscriptions: [],
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
        dropIns: [],
        classSubstitutions: [],
        retentionContacts: [],
        journal: [],
        auditEvents: [],
        aiTokens: [],
        aiChatAcceptances: [],
        aiChatConversations: [],
        aiChatUsages: [],
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
    // Accepted when the current edition came out (versions are its date), not
    // 300 days before it: «Тариф» shows both dates side by side.
    const editionYmd = [input.legal.offerVersion, input.legal.dpaVersion].sort().at(-1) ?? today
    const editionAt = /^\d{4}-\d{2}-\d{2}$/.test(editionYmd) ? at(editionYmd, '12:00') : now
    plan.legalAcceptance = {
        workspaceId,
        userId: ownerId,
        userEmail: demoAccount('owner').email,
        userName: demoAccountName(demoAccount('owner')),
        offerVersion: input.legal.offerVersion,
        dpaVersion: input.legal.dpaVersion,
        source: 'CONSOLE',
        acceptedAt: editionAt < now ? editionAt : now,
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
    // The academy is a grappling club: its ladder reads «1 тренировка …».
    const vocabulary = vocabularyForWorkspaceType('GRAPPLING')
    for (const d of DIRECTIONS) {
        plan.achievements.push(...defaultAchievementRows(workspaceId, dirId(d.key), vocabulary))
    }
    plan.achievements.push(...defaultAchievementRows(workspaceId, null, vocabulary))

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
    const shuffle = <T>(list: T[], random = rnd): T[] => {
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1))
            ;[list[i], list[j]] = [list[j], list[i]]
        }
        return list
    }
    const generatedOlder = persons.filter((p) => !fixedPeople.has(p) && p.kind !== 'kid')
    // A healthy club: about one in ten slipping away (the at-risk list), a few
    // who came to the free trial and never bought, a few who left long ago, the
    // rest training.
    const quotas: [Archetype, number][] = [
        ['fanatic', 10],
        ['newcomer', 12],
        ['stuckNewcomer', 3],
        ['trialOnly', 4],
        ['declining', 4],
        ['absent', 3],
        ['lapsed', 5],
        ['churned', 10],
        ['casual', 26],
    ]
    const deck: Archetype[] = quotas.flatMap(([a, n]) => Array<Archetype>(n).fill(a))
    while (deck.length < generatedOlder.length) deck.push('regular')
    shuffle(deck)
    generatedOlder.forEach((p, i) => (p.archetype = deck[i]))
    // Nobody left the top coach long ago: a churned one there trades places
    // with a regular of another coach.
    const coachOf = (p: Person) => groupDef(p.groups[0].key).coach
    for (const p of generatedOlder.filter((x) => x.archetype === 'churned' && coachOf(x) === TOP_COACH)) {
        const other = generatedOlder.find((x) => x.archetype === 'regular' && coachOf(x) !== TOP_COACH)
        if (!other) break
        other.archetype = 'churned'
        p.archetype = 'regular'
    }
    const generatedKids = persons.filter((p) => !fixedPeople.has(p) && p.kind === 'kid')
    generatedKids.forEach(
        (p, i) =>
            (p.archetype =
                i % 15 === 3 ? 'newcomer' : i % 37 === 7 ? 'declining' : i % 41 === 11 ? 'lapsed' : 'regular'),
    )

    // Those slipping away need a few months of steady visits behind them; the
    // rest joined any time over the last two years, some a month ago.
    const settled: Archetype[] = ['declining', 'absent', 'lapsed']
    for (const p of persons) {
        if (fixedPeople.has(p)) continue
        const since =
            p.archetype === 'newcomer'
                ? int(4, 24)
                : p.archetype === 'stuckNewcomer'
                  ? int(20, 34)
                  : p.archetype === 'trialOnly'
                    ? int(15, 50)
                    : p.archetype === 'churned'
                      ? // Left 3–5 months ago, after a long run.
                        int(300, 720)
                      : p.kind === 'kid'
                        ? int(settled.includes(p.archetype) ? 100 : 30, 500)
                        : int(settled.includes(p.archetype) ? 110 : 30, 720)
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
                      trialOnly: 2,
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

    // People who left during the year (LEAVERS_PER_PLACE): most within their
    // first months, everyone at least six weeks ago. No member row or roster
    // place — the club removed them; the visits and abonements stay.
    for (const g of GROUPS) {
        const share = g.coach === TOP_COACH ? TOP_COACH_LEAVERS_PER_PLACE : LEAVERS_PER_PLACE
        for (let n = Math.round(g.size * share); n > 0; n--) {
            const p = newPerson({ kind: g.kind, female: rnd() < femaleShare(g), ages: g.ages, groups: [g.key] })
            p.status = 'LEFT'
            const r = rnd()
            const stayed = r < 0.22 ? int(5, 28) : r < 0.47 ? int(30, 60) : r < 0.62 ? int(61, 91) : int(92, 180)
            setJoin(p, int(stayed + 42, DEMO_HISTORY_DAYS - 7))
            p.stopYmd = addDaysYmd(p.joinYmd, stayed)
            p.target = p.kind === 'kid' ? 1.4 + rnd() * 0.4 : 1.6 + rnd() * 0.8
        }
    }

    // ---- tariffs and abonement chains ------------------------------------------
    const dirsOf = (p: Person) => [...new Set(p.groups.map((g) => groupDef(g.key).dir))]
    const tariffsFor = (p: Person): TariffDef[] => {
        if (p.status !== 'ACTIVE') return []
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
    const newSub = (p: Person, t: TariffDef, chain: number, startYmd: string, endYmd: string, draw = int): Sub => {
        // Sold at the reception before the first class of the day. A tariff
        // counted from the first training starts at that day's club midnight
        // (first-visit-start.ts); the first visit is that day.
        const saleTime = `07:${pad2(draw(0, 59))}`
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
        if (p.archetype === 'trialOnly') {
            p.subs.push(newSub(p, tariffDef('trial'), 9, p.joinYmd, addDaysYmd(p.joinYmd, 14)))
            continue
        }
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
        const floor = p.joinYmd > historyStart ? p.joinYmd : historyStart
        tariffs.forEach((t, chain) => {
            let end =
                p.archetype === 'lapsed'
                    ? ago(int(4, 18))
                    : p.archetype === 'churned'
                      ? ago(int(100, 150))
                      : p.archetype === 'absent'
                        ? ahead(int(8, 26))
                        : ahead(int(1, t.days - 1))
            // Lapsed: came a few times on the last abonement, stopped a month
            // or more ago, and it ran out unrenewed. Churned: left months ago.
            if (p.archetype === 'lapsed' || p.archetype === 'churned') {
                const stop = addDaysYmd(end, p.archetype === 'lapsed' ? -int(27, 30) : -int(0, 4))
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

    // The rest of the sales history draws from its own stream, so the club as
    // generated above (members, their chains, visits) stays exactly the same.
    const rndHistory = makeRng(SEED + 1)
    const intHistory = (a: number, b: number) => a + Math.floor(rndHistory() * (b - a + 1))

    // Those who left paid like everyone else: a chain from their first
    // training, the last abonement covering their stop day and never renewed.
    // The rows stay with the club after the removal (no member, see
    // Subscription.workspaceMemberId), so revenue and the renewal share in
    // «Аналитика» count the ones who left, not only the ones who stayed.
    for (const p of persons) {
        if (p.status !== 'LEFT' || !p.stopYmd) continue
        const t = tariffDef(
            p.kind === 'kid'
                ? rndHistory() < 0.7 ? 'pack8' : 'pack12'
                : dirsOf(p).includes('muay') && rndHistory() < 0.6
                  ? 'muay12'
                  : rndHistory() < 0.15 ? 'unlim' : 'pack12',
        )
        for (let start = p.joinYmd; start <= p.stopYmd; start = addDaysYmd(start, t.days)) {
            const s = newSub(p, t, 0, start, addDaysYmd(start, t.days), intHistory)
            if (start !== p.joinYmd && rndHistory() < RENEW_AHEAD_SHARE) {
                s.soldAt = new Date(s.soldAt.getTime() - intHistory(...RENEW_AHEAD_DAYS) * DAY_MS)
            }
            p.subs.push(s)
        }
    }

    // Breaks: a holiday, an injury, exams — a regular skips a month and buys
    // the next abonement when back, at the reception (not ahead), so the one
    // before the break counts as not renewed. Only in the judged past, far
    // enough from today not to touch the risk signals; never the first or the
    // last two of a chain.
    const takesBreaks: Archetype[] = ['regular', 'fanatic', 'casual', 'declining', 'absent']
    for (const p of persons) {
        if (p.status !== 'ACTIVE' || fixedPeople.has(p) || !takesBreaks.includes(p.archetype)) continue
        for (const chain of new Set(p.subs.map((s) => s.chain))) {
            const subs = p.subs.filter((s) => s.chain === chain)
            for (let i = 1; i < subs.length - 2; i++) {
                const s = subs[i]
                if (s.startYmd < ago(BREAK_WINDOW_DAYS[1]) || s.startYmd > ago(BREAK_WINDOW_DAYS[0])) continue
                if (rndHistory() >= BREAK_SHARE) continue
                p.subs.splice(p.subs.indexOf(s), 1)
                const back = subs[i + 1]
                back.soldAt = back.tariff.startsOnFirstVisit ? at(back.startYmd, '07:30') : back.startAt
                // The one after a break is not skipped too.
                i += 1
            }
        }
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
    const pull = (k: GroupKey, slot: number) => SLOT_PULL[`${k}:${slot}`] ?? 1
    const pullPerWeek = (p: Person) =>
        p.groups.reduce((n, g) => n + groupDef(g.key).slots.reduce((m, _, i) => m + pull(g.key, i), 0), 0) || 1
    // The member's weekly target spread over their slots by each slot's pull.
    const chance = (p: Person, groupJoin: string, ymd: string, slotPull = 1): number => {
        if (ymd < groupJoin) return 0
        if (p.stopYmd && ymd > p.stopYmd) return 0
        if (p.archetype === 'trialOnly') return p.visits === 0 ? 0.95 : 0
        const base = Math.min(0.95, (p.target * slotPull) / pullPerWeek(p))
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
        markedAfterMin = int(5, 20),
    ) => {
        const consumed = sub && sub.remaining !== null
        if (sub && sub.remaining !== null) sub.remaining -= 1
        p.visits += 1
        plan.records.push({
            sessionId,
            workspaceId,
            userId: p.id,
            markedById,
            markedAt: new Date(startAt.getTime() + markedAfterMin * 60_000),
            usedSubscriptionId: sub?.id ?? null,
            consumedSubscriptionId: consumed ? sub.id : null,
        })
    }

    const members = persons.filter((p) => p.status === 'ACTIVE')
    // Members and those who left (they came until their stop day; a visit
    // their used-up pack no longer covers is still marked).
    const rosters = new Map(
        GROUPS.map((g) => [
            g.key,
            persons.filter((p) => p.status !== 'INVITED' && p.groups.some((x) => x.key === g.key)),
        ]),
    )
    // Saturday BJJ at «Шарики»: «Юпитер» drops in.
    const shGuests = members.filter(
        (p) => p.groups.some((x) => x.key === 'yuBjj') && !p.groups.some((x) => x.key === 'shBjjEvening'),
    )
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
                const guests = g.key === 'shBjjEvening' && day === 6 ? shGuests : []
                for (const p of rosters.get(g.key)!) {
                    const join = p.groups.find((x) => x.key === g.key)!.joinYmd
                    if (rnd() >= chance(p, join, ymd, pull(g.key, i))) continue
                    const sub = coveringSub(p, g.dir, startAt)
                    if (!sub && p.status !== 'LEFT') continue
                    recordVisit(p, sessionId, staffId(g.coach), startAt, sub)
                    lastVisit.set(p.id, ymd)
                }
                for (const p of guests) {
                    if (rnd() >= chance(p, p.joinYmd, ymd) * SATURDAY_GUEST_SHARE) continue
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

    // ---- «Запись на занятие» ---------------------------------------------------------
    // A BOOKING group: members of the club book a place one class at a time,
    // a full class has a waitlist. ~30 regulars with a club-wide abonement (the
    // group has no direction) book it. The last three weeks are settled the way
    // the sweep settles them: attended (charged like any visit), no-shows and
    // late cancels (a pack loses a class — the club's burn switches are on by
    // default), a place freed in time going to the waitlist. The next week is
    // open: full classes with a waitlist, others with places left. Елена
    // (parent@) has her own bookings, so «Мои записи» has something to show.
    // Its own rng: the rest of the club comes out exactly as without it.
    // Window and free-cancel deadline: the club's defaults
    // (Workspace.bookingWindowDays / bookingCancelHours).
    const BOOKING_WINDOW_DAYS = 14
    const BOOKING_CANCEL_HOURS = 12
    const brnd = makeRng(SEED + 1)
    const bint = (a: number, b: number) => a + Math.floor(brnd() * (b - a + 1))
    const bg = BOOKING_GROUP
    const bgId = demoUuid(`group:${bg.key}`)
    const bgSlotId = (i: number) => demoUuid(`slot:${bg.key}:${i}`)
    const bgCoachId = staffId(bg.coach)
    plan.groups.push({
        id: bgId,
        workspaceId,
        name: `${bg.name} · ${GYMS.find((x) => x.key === bg.gym)?.short}`,
        gymId: gymId(bg.gym),
        directionId: null,
        coachId: bgCoachId,
        bookingMode: 'BOOKING',
        capacity: bg.capacity,
        createdAt: at(ago(45), '11:00'),
    })
    plan.groupCoaches.push({ groupId: bgId, userId: bgCoachId, role: 'primary' })
    bg.slots.forEach(([dayOfWeek, startTime, durationMin, capacity], i) => {
        plan.slots.push({ id: bgSlotId(i), groupId: bgId, dayOfWeek, startTime, durationMin, capacity })
    })

    // What a class at `startAt` would be spent on (visit-abonement.ts): a
    // club-wide abonement running then — or, for a class ahead, one bought and
    // waiting for its first training — with a class left; soonest end first.
    const bookingSubs = (p: Person, startAt: Date): Sub[] =>
        p.subs
            .filter(
                (s) =>
                    s.status === 'ACTIVE' &&
                    covers(s, null) &&
                    (s.pending ? startAt > now : s.startAt <= startAt && startAt < s.endAt) &&
                    (s.remaining === null || s.remaining > 0),
            )
            .sort(
                (a, b) =>
                    (a.pending ? Infinity : a.endAt.getTime()) - (b.pending ? Infinity : b.endAt.getTime()) ||
                    a.soldAt.getTime() - b.soldAt.getTime(),
            )
    // Packs can't be over-promised: live bookings ahead stay below the classes
    // left, unless a time-based abonement pays.
    const liveAhead = new Map<string, number>()
    const canBook = (p: Person, startAt: Date) => {
        const subs = bookingSubs(p, startAt)
        if (subs.length === 0) return false
        if (startAt < now || subs.some((s) => s.remaining === null)) return true
        return (liveAhead.get(p.id) ?? 0) < subs.reduce((n, s) => n + (s.remaining ?? 0), 0)
    }
    const onHold = new Set([...frozen, ...requesters])
    const bookers = shuffle(
        members.filter(
            (p) =>
                !fixedPeople.has(p) &&
                !onHold.has(p) &&
                p.kind === 'adult' &&
                !p.stopYmd &&
                (['regular', 'fanatic', 'casual'] as Archetype[]).includes(p.archetype) &&
                p.subs.some((s) => covers(s, null)),
        ),
        brnd,
    ).slice(0, bg.regulars)

    const bookedClasses: { i: number; ymd: string; startAt: Date; endAt: Date; capacity: number }[] = []
    for (let ymd = ago(21); ymd <= ahead(7); ymd = addDaysYmd(ymd, 1)) {
        bg.slots.forEach(([day, time, min, places], i) => {
            const startAt = at(ymd, time)
            // Today's class once it has begun: neither settled nor open.
            if (day !== dow(ymd) || (ymd >= today && startAt <= now)) return
            bookedClasses.push({
                i,
                ymd,
                startAt,
                endAt: new Date(startAt.getTime() + min * 60_000),
                capacity: places ?? bg.capacity,
            })
        })
    }
    const pastClasses = bookedClasses.filter((c) => c.startAt < now).length
    const burnedSubs = new Set<Sub>()
    // The burn of a late cancel / no-show: one class off the pack the visit
    // would have been spent on; a time-based abonement loses nothing.
    const burn = (p: Person, startAt: Date) => {
        const s = bookingSubs(p, startAt)[0]
        if (!s || s.remaining === null) return { classBurned: false, burnedSubscriptionId: null }
        s.remaining -= 1
        burnedSubs.add(s)
        return { classBurned: true, burnedSubscriptionId: s.id }
    }
    bookedClasses.forEach((c, n) => {
        const past = c.startAt < now
        const j = past ? n : n - pastClasses
        const key = scheduledOccurrenceKey(bgSlotId(c.i), c.ymd)
        const occurrenceId = demoUuid(`class:${key}`)
        const sessionId = demoUuid(`session:${bg.key}:${c.i}:${c.ymd}`)
        const deadline = c.startAt.getTime() - BOOKING_CANCEL_HOURS * 60 * 60_000

        // Елена: attended twice and cancelled late once; ahead, first on the
        // waitlist of the nearest class and booked into the next one.
        const parentRole = past
            ? j === pastClasses - 2 || j === pastClasses - 6
                ? 'attend'
                : j === pastClasses - 4
                  ? 'late'
                  : null
            : j === 0
              ? 'wait'
              : j === 1
                ? 'book'
                : null
        const withParent = parentRole !== null && canBook(parent, c.startAt)
        const full = past ? j % 3 !== 2 : j % 2 === 0
        const holders = full ? c.capacity : c.capacity - bint(2, 4)
        const queue = full ? (past ? bint(0, 2) : bint(2, 3)) : 0
        const pool = shuffle(
            bookers.filter((p) => canBook(p, c.startAt)),
            brnd,
        )
        const people = pool.slice(0, holders + queue - (withParent ? 1 : 0))
        if (withParent) {
            const seat =
                parentRole === 'wait'
                    ? Math.min(holders, people.length)
                    : bint(0, Math.min(holders, people.length) - 1)
            people.splice(seat, 0, parent)
        }
        // Booked in the days before, in this order (the waitlist goes by it).
        const from = past
            ? c.startAt.getTime() - 6 * DAY_MS
            : Math.max(at(addDaysYmd(c.ymd, -BOOKING_WINDOW_DAYS), '00:00').getTime(), now.getTime() - 5 * DAY_MS)
        const until = past ? deadline - 60 * 60_000 : now.getTime() - 20 * 60_000
        const times = people.map(() => from + brnd() * (until - from)).sort((a, b) => a - b)
        const row = (
            p: Person,
            createdAt: number,
            status: Prisma.ClassBookingCreateManyInput['status'],
            extra: Partial<Prisma.ClassBookingCreateManyInput> = {},
        ) =>
            plan.classBookings.push({
                id: demoUuid(`booking:${key}:${p.id}`),
                workspaceId,
                occurrenceId,
                userId: p.id,
                status,
                bookedById: p.id,
                createdAt: new Date(createdAt),
                ...extra,
            })
        plan.classOccurrences.push({
            id: occurrenceId,
            workspaceId,
            groupId: bgId,
            slotId: bgSlotId(c.i),
            sessionDate: ymdToDbDate(c.ymd),
            occurrenceKey: key,
            startAt: c.startAt,
            endAt: c.endAt,
            // Settled by the sweep two hours after the end.
            settledAt: past ? new Date(c.endAt.getTime() + (120 + bint(1, 4)) * 60_000) : null,
            createdAt: new Date(times[0] ?? from),
        })

        if (!past) {
            people.forEach((p, k) => {
                row(p, times[k], k < holders ? 'BOOKED' : 'WAITLISTED')
                liveAhead.set(p.id, (liveAhead.get(p.id) ?? 0) + 1)
            })
            return
        }

        const holding = people.slice(0, holders).map((p, k) => ({ p, createdAt: times[k], promotedAt: null as Date | null }))
        const queued = people.slice(holders).map((p, k) => ({ p, createdAt: times[holders + k] }))
        // A place given up in time goes to the first on the waitlist.
        if (queued.length > 0 && j % 2 === 0) {
            const k = holding.findIndex((h) => h.p !== parent)
            const cancelledAt = new Date(queued[0].createdAt + brnd() * (deadline - 30 * 60_000 - queued[0].createdAt))
            row(holding[k].p, holding[k].createdAt, 'CANCELLED', { cancelledAt })
            holding.splice(k, 1, { ...queued.shift()!, promotedAt: cancelledAt })
        }
        for (const q of queued) row(q.p, q.createdAt, 'EXPIRED')
        // Staff added one more over the places.
        const extra = j === 3 && full ? pool.find((p) => !people.includes(p)) : undefined
        const others = holding.filter((h) => h.p !== parent).map((h) => h.p)
        const late = new Set(j % 4 === 1 ? [others[bint(0, others.length - 1)]] : [])
        if (parentRole === 'late' && withParent) late.add(parent)
        const noShow = j % 2 === 0 ? others.filter((p) => !late.has(p))[bint(0, others.length - 2)] : undefined
        let attended = 0
        for (const h of holding) {
            const promotedAt = h.promotedAt
            if (late.has(h.p)) {
                const cancelledAt = new Date(deadline + brnd() * (c.startAt.getTime() - 30 * 60_000 - deadline))
                row(h.p, h.createdAt, 'LATE_CANCELLED', { promotedAt, cancelledAt, ...burn(h.p, c.startAt) })
            } else if (h.p === noShow) {
                row(h.p, h.createdAt, 'NO_SHOW', { promotedAt, ...burn(h.p, c.startAt) })
            } else {
                recordVisit(h.p, sessionId, bgCoachId, c.startAt, bookingSubs(h.p, c.startAt)[0] ?? null, bint(5, 15))
                row(h.p, h.createdAt, 'ATTENDED', { promotedAt })
                attended += 1
            }
        }
        if (extra) {
            recordVisit(extra, sessionId, bgCoachId, c.startAt, bookingSubs(extra, c.startAt)[0] ?? null, bint(5, 15))
            row(extra, c.startAt.getTime() - 15 * 60_000, 'ATTENDED', { bookedById: bgCoachId, overCapacity: true })
            attended += 1
        }
        if (attended > 0) {
            plan.sessions.push({
                id: sessionId,
                workspaceId,
                groupId: bgId,
                slotId: bgSlotId(c.i),
                sessionDate: ymdToDbDate(c.ymd),
                occurrenceKey: key,
                title: bg.name,
                startAt: c.startAt,
                timezone: tz,
                coachId: bgCoachId,
                createdById: bgCoachId,
                createdAt: c.startAt,
            })
        }
    })
    // A pack the bookings used up, renewed since, was closed by the sale.
    for (const s of burnedSubs) {
        const p = persons.find((x) => x.subs.includes(s))!
        const renewed = p.subs.some((x) => x.chain === s.chain && !x.pending && x.startAt > s.startAt)
        if (s.remaining === 0 && renewed) s.status = 'EXPIRED'
    }

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
                paymentMethod: s.isPaid && s.tariff.price > 0 ? demoPaymentMethod(s.id) : null,
                classesTotal: s.tariff.classes,
                classesRemaining: s.remaining,
                // Those who left keep the abonements with no member.
                workspaceMemberId: p.status === 'LEFT' ? null : demoUuid(`member:${p.idx}`),
                userId: p.id,
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
                status: p.status === 'INVITED' ? 'INVITED' : 'ACTIVE',
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

    // Those who left keep their account; the club has no number of theirs.
    for (const p of persons.filter((x) => x.status === 'LEFT')) {
        addUser({
            id: p.id,
            email: p.email,
            firstname: p.firstname,
            lastname: p.lastname,
            createdYmd: p.joinYmd,
            dob: p.dob,
            lastSeenYmd: p.stopYmd ?? p.joinYmd,
        })
    }

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
    // The group's next session from tomorrow on, whatever weekday the demo is
    // reset: the guest booking and the substitutions below land within a couple
    // of days, not a week away when the reset happens on the slot's own weekday.
    const soonestSlot = (g: GroupKey): number =>
        groupDef(g)
            .slots.map((s, i) => ({ i, ymd: nextDow(s[0]) }))
            .reduce((a, b) => (b.ymd < a.ymd ? b : a)).i
    // student@ comes as a guest to the session Савельев takes over (see below).
    book(student, 'yuBjj', soonestSlot('yuBjj'))
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

    // ---- substitutions ahead ---------------------------------------------------------
    const substitute = (
        g: GroupKey,
        slot: number,
        who: StaffKey,
        kind: 'ASSIGN' | 'OFFER',
        by: StaffKey,
    ) => {
        const ymd = nextDow(groupDef(g).slots[slot][0])
        const createdAt = new Date(now.getTime() - 26 * 60 * 60 * 1000)
        const approved = kind === 'ASSIGN'
        plan.classSubstitutions.push({
            id: demoUuid(`substitution:${g}:${slot}`),
            workspaceId,
            groupId: groupId(g),
            slotId: slotId(g, slot),
            sessionDate: ymdToDbDate(ymd),
            occurrenceKey: scheduledOccurrenceKey(slotId(g, slot), ymd),
            substituteId: staffId(who),
            status: approved ? 'APPROVED' : 'PENDING',
            kind,
            requestedById: staffId(by),
            decidedById: approved ? staffId(by) : null,
            decidedAt: approved ? createdAt : null,
            createdAt,
        })
    }
    // Решетюк is away: Савельев (head coach) runs his next БЖЖ at «Юпитер» —
    // student@ booked into it and sees «Замена: Р. Савельев».
    substitute('yuBjj', soonestSlot('yuBjj'), 'savelyev', 'ASSIGN', 'reshetyuk')
    // Власов offers to take Старокоров's next ММА at «Белая рысь»: waits for the go-ahead.
    substitute('rysMma', soonestSlot('rysMma'), 'vlasov', 'OFFER', 'vlasov')

    // ---- announcements -----------------------------------------------------------------
    const announce = (
        by: StaffKey,
        title: string,
        body: string,
        daysAgo: number | null,
        extra: { pinned?: boolean; dir?: DirKey; groups?: GroupKey[]; expiring?: boolean } = {},
    ) => {
        const id = demoUuid(`announcement:${plan.announcements.length}`)
        plan.announcements.push({
            id,
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
        for (const key of extra.groups ?? []) {
            plan.announcementGroups.push({ announcementId: id, groupId: groupId(key) })
        }
    }
    announce('owner', 'Тайский бокс теперь и в Северске', 'Группа «Тайский бокс Взрослые» в СК «Центр тайского бокса», ул. Транспортная, 32. Персональные тренировки — по записи в приложении.', 20, { pinned: true })
    announce('admin', 'Заморозка — в приложении', 'Заявку на заморозку абонемента можно отправить прямо в приложении: Профиль → «Мой абонемент». Рассмотрим в течение дня. Продлить абонемент можно у тренера или на ресепшене.', 6)
    announce('admin', 'Ваш абонемент скоро закончится', 'Продлите абонемент до конца недели — и следующая неделя тренировок пройдёт без перерыва. Скидка 5% при продлении в день окончания.', 2, { expiring: true })
    // Only the adult BJJ groups: the kids (Миша) never see the adults' grading,
    // so it can stay pinned on top of the adults' home.
    announce('reshetyuk', `Аттестация взрослых на синие пояса — ${nextGradingYmd.split('-').reverse().slice(0, 2).join('.')}`, 'Кто допущен и сколько тренировок осталось до готовности — в «Прогресс» → «Мой ранг». Готовность считается по посещениям.', 3, {
        pinned: true,
        groups: GROUPS.filter((g) => g.dir === 'bjj' && g.kind === 'adult').map((g) => g.key),
    })
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

    // ИИ-ассистент: the owner's Claude token (обезличено) with a few recent
    // questions in the journal, and an old ChatGPT token already revoked.
    const aiToken = (key: string, over: Partial<Prisma.AiAccessTokenCreateManyInput>) =>
        plan.aiTokens.push({
            id: demoUuid(`ai-token:${key}`),
            workspaceId,
            createdById: ownerId,
            name: key,
            tokenHash: `demo-token:${demoUuid(`ai-token:${key}`)}`,
            tokenPrefix: 'csai_demo',
            scopes: ['read'],
            dataMode: 'PSEUDONYMIZED',
            ...over,
        })
    aiToken('Claude — директор', {
        createdAt: at(ago(6), '21:10'),
        expiresAt: new Date(now.getTime() + 84 * DAY_MS),
        lastUsedAt: new Date(now.getTime() - 40 * 60_000),
    })
    aiToken('ChatGPT — проба', {
        createdAt: at(ago(40), '10:00'),
        expiresAt: new Date(now.getTime() + 50 * DAY_MS),
        lastUsedAt: at(ago(35), '10:30'),
        revokedAt: at(ago(30), '09:00'),
        revokedById: ownerId,
    })
    const claudeId = demoUuid('ai-token:Claude — директор')
    const aiCalls: [number, string, Record<string, Prisma.InputJsonValue>, number][] = [
        [6, 'club_overview', {}, 1],
        [6, 'at_risk_members', { limit: 20 }, 20],
        [3, 'revenue_report', { groupBy: 'direction', months: 6 }, 4],
        [1, 'renewals_due', { limit: 20 }, 12],
        [0, 'schedule', { from: today }, 30],
    ]
    for (const [d, tool, args, rows] of aiCalls) {
        audit('ai.toolCall', 'aiToken', claudeId, 'owner', d === 0 ? new Date(now.getTime() - 40 * 60_000) : at(ago(d), '21:15'), {
            tool,
            args,
            rows,
            isError: false,
            tokenName: 'Claude — директор',
            dataMode: 'PSEUDONYMIZED',
        })
    }

    // ИИ-ассистент chat in the admin: turned on by the owner a week ago, and
    // the owner's saved conversation «Кому позвонить сегодня?» — the model's
    // side pseudonymized exactly as a live turn would be, one student per risk
    // reason, their groups as chips.
    plan.aiChatAcceptances.push({
        id: demoUuid('ai-chat-consent'),
        workspaceId,
        userId: ownerId,
        userEmail: demoAccount('owner').email,
        userName: demoAccountName(demoAccount('owner')),
        warningVersion: AI_CHAT_DATA_WARNING.version,
        acceptedAt: at(ago(7), '20:55'),
    })
    const atRisk = (['absent', 'declining', 'lapsed'] as const).flatMap((reason) => {
        const p = members.find(
            (x) => x.archetype === reason && x.kind === 'adult' && !fixedPeople.has(x) && lastVisit.has(x.id),
        )
        return p ? [{ p, reason, last: lastVisit.get(p.id)! }] : []
    })
    const ref = (userId: string) => pseudonymFor(input.pseudonymSecret, workspaceId, userId, 'member')
    const reasonLabel = {
        absent: 'Давно не приходил',
        declining: 'Стал ходить заметно реже',
        lapsed: 'Абонемент закончился и не продлён',
    } as const
    const advice = {
        absent: 'спросите, всё ли в порядке, и предложите удобное время',
        declining: 'узнайте, не мешает ли расписание, — возможно, подойдёт другая группа',
        lapsed: 'предложите продление, пока привычка не пропала',
    } as const
    const toolResult = {
        total: atRisk.length,
        nextOffset: null,
        items: atRisk.map(({ p, reason, last }) => ({
            member: { ref: ref(p.id) },
            reason,
            reasonLabel: reasonLabel[reason],
            lastVisitAt: at(last, '20:00').toISOString(),
            daysSinceLastVisit: diffDaysYmd(today, last),
            groups: p.groups.map((g) => ({ id: groupId(g.key), name: groupDef(g.key).name })),
            lastContactAt: null,
            snoozed: false,
        })),
    }
    const answer = [
        `Сегодня стоит позвонить ${atRisk.length === 1 ? 'одному ученику' : `${atRisk.length} ученикам`} — по одному на каждую причину ухода:`,
        '',
        ...atRisk.map(
            ({ p, reason, last }, i) =>
                `${i + 1}. ${ref(p.id)} — ${reasonLabel[reason].toLowerCase()}, последний визит ${diffDaysYmd(today, last)} дн. назад` +
                `${p.groups[0] ? `, группа [group:${groupId(p.groups[0].key)}]` : ''}: ${advice[reason]}.`,
        ),
        '',
        'Начните с первого: чем дольше пауза, тем труднее вернуться. После звонка отметьте его в «Кому позвонить» — список обновится.',
    ].join('\n')
    const askedAt = at(ago(1), '21:05')
    plan.aiChatConversations.push({
        id: demoUuid('ai-chat:call-today'),
        workspaceId,
        userId: ownerId,
        title: 'Кому позвонить сегодня?',
        messages: [
            { role: 'user', content: 'Кому позвонить сегодня?', text: 'Кому позвонить сегодня?', at: askedAt.toISOString() },
            {
                role: 'assistant',
                content: '',
                toolCalls: [{ id: 'call_demo_1', name: 'at_risk_members', arguments: '{"limit":5}' }],
            },
            {
                role: 'tool',
                toolCallId: 'call_demo_1',
                name: 'at_risk_members',
                content: JSON.stringify(toolResult),
                isError: false,
            },
            { role: 'assistant', content: answer },
        ],
        refs: Object.fromEntries(atRisk.map(({ p }) => [ref(p.id), { kind: 'member', userId: p.id }])),
        createdAt: askedAt,
    })
    plan.aiChatUsages.push({
        id: demoUuid('ai-chat-usage:call-today'),
        workspaceId,
        userId: ownerId,
        conversationId: demoUuid('ai-chat:call-today'),
        model: 'demo',
        toolCalls: 1,
        createdAt: askedAt,
    })

    return plan
}
