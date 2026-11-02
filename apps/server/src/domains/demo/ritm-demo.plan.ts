import {
    eventOccurrenceKey,
    isoDayOfWeek,
    localDateInTz,
    scheduledOccurrenceKey,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import { GUARDIAN_CONSENT_VERSION } from '../../features/dependents/dependents-utils'
import { defaultAchievementRows } from '../../features/manage-achievements/default-achievement-rows'
import type { Prisma } from '../../infrastructure/prisma'
import {
    cap,
    countNoun,
    fromFirstSession,
    vocabularyForWorkspaceType,
} from '../../shared/utils/club-vocabulary'
import { AI_CHAT_DATA_WARNING } from '../ai-assistant/ai-chat-warning'
import { pseudonymFor } from '../ai-assistant/pseudonym'
import { FIRST_VISIT_AUTO_START_DAYS } from '../subscriptions/first-visit-start'
import { addDaysYmd, diffDaysYmd, ymdToDbDate } from '../subscriptions/freeze-dates'
import { defaultFeatureColumnsFor } from '../workspace/feature-flags'
import { type DemoAccountKey, demoAccountName } from './demo-accounts'
import {
    FEMALE_NAMES,
    MALE_NAMES,
    SURNAMES,
    femaleSurname,
    translit,
} from './demo-club.catalog'
import {
    type DemoClubPlan,
    type DemoPlanInput,
    type DemoRoleName,
    demoPaymentMethod,
    demoUuid,
} from './demo-club.plan'
import {
    RITM_ACCOUNTS,
    RITM_CLUB_KEY,
    RITM_CLUB_NAME,
    RITM_EMAIL_DOMAIN,
    RITM_JOIN_CODE,
    RITM_PARENT_CHILDREN,
} from './ritm-demo.accounts'

// The dance-studio demo club «Ритм» (docs/demo.md), built the way ACADEMY is
// (demo-club.plan.ts) but smaller: two halls, six directions, ~70 students
// (about a third children with their parents), abonements 4/8/12, a single and
// a free trial, a year of visits, «Растяжка» by booking with places and a
// waitlist, a paid master class with a waitlist, a freeze and a freeze request,
// a substitution, the owner's ИИ-чат and placeholder videos of combinations.
// Deterministic: the same club-local day always yields the same rows, ids and
// counts; every date is relative to today. Pure — demo-club.writer.ts inserts
// the rows. Texts that name a class or a teacher come from the DANCE
// vocabulary («занятие», «педагог»), never «тренировка / тренер».
//
// A healthy studio, as ACADEMY is a healthy club: about one in ten students
// in «Кто пропадает», about four in five abonements renewed («Прогноз»), the
// cohorts of «Удержание» falling the way they do — most of those who leave
// leave in the first months.

const DAY_MS = 24 * 60 * 60 * 1000
const SEED = 20_261_103
// A year and a month of visits and sales: «Аналитика» reads twelve monthly
// cohorts by the first class, and the risk rules read the first visit (a
// newcomer is under 90 days).
export const RITM_HISTORY_DAYS = 400
const FAR_FUTURE_DAYS = 5 * 365
const ADULTS = 50
const KIDS = 22
// Children whose parent confirmed the link; the rest wait for the parent.
const CONFIRMED_PARENTS = 14
// Adults who came during the year and left. The studio removed them; their
// visits and abonements stay (no member, see Subscription.workspaceMemberId),
// so the cohorts and the renewal share count them.
const LEAVERS = 36
// A regular buys the next abonement ahead — right after the class that used
// the last one, or at the last class before the end — and it waits for its
// first class (FIRST_VISIT_AUTO_START_DAYS at most); the rest buy at the
// reception before the next class.
const RENEW_AHEAD_SHARE = 0.85
// Breaks: a holiday, exams — every two months of the past year a regular may
// skip four to seven weeks and buy the next abonement when back, so the one
// before the break is not renewed. Far enough from today not to touch the
// risk signals.
const BREAK_SHARE = 0.5
const BREAK_WINDOW_DAYS: [number, number] = [75, 330]

const ritmId = (name: string) => demoUuid(`ritm:${name}`)

type StaffKey = 'owner' | 'korolyova' | 'orekhova' | 'akhmetov'
type DirKey = 'hiphop' | 'heels' | 'contemp' | 'stretch' | 'kids' | 'master'
type GymKey = 'big' | 'small'
type GroupKey = 'heelsBeg' | 'heelsPro' | 'hipBeg' | 'contemp' | 'kidsJunior' | 'kidsTeen'
type TariffKey = 'trial' | 'single' | 'pack4' | 'pack8' | 'pack12' | 'kids8'
type Archetype = 'regular' | 'newcomer' | 'lapsed' | 'declining' | 'trialOnly'

type GroupDef = {
    key: GroupKey
    name: string
    dir: DirKey
    gym: GymKey
    coach: StaffKey
    kind: 'adult' | 'kid'
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
    dirs: DirKey[]
    isFreeTrial?: boolean
    startsOnFirstVisit?: boolean
}

type Sub = {
    id: string
    tariff: TariffDef
    soldAt: Date
    startAt: Date
    endAt: Date
    remaining: number
    isPaid: boolean
    // Bought ahead, counted from the first class that has not happened yet;
    // endAt is the provisional access end.
    pending?: boolean
}

type Person = {
    idx: number
    id: string
    firstname: string
    lastname: string
    email: string | null
    kind: 'adult' | 'kid'
    dob: string | null
    groups: GroupKey[]
    archetype: Archetype
    joinYmd: string
    stopYmd: string | null
    // Left the studio (no member any more), see LEAVERS.
    left?: boolean
    // Breaks of a few weeks in the past: [from, until).
    pauses: [string, string][]
    // Classes a week.
    target: number
    account?: DemoAccountKey
    subs: Sub[]
    visits: number
}

const VOCABULARY = vocabularyForWorkspaceType('DANCE')
const FROM_FIRST = `30 дней ${fromFirstSession(VOCABULARY)}`

const GYMS: readonly { key: GymKey; name: string; address: string }[] = [
    { key: 'big', name: 'Большой зал', address: 'Томск, ул. Летняя, 15 · 2 этаж' },
    { key: 'small', name: 'Малый зал', address: 'Томск, ул. Летняя, 15 · 3 этаж' },
]

const DIRECTIONS: readonly { key: DirKey; name: string; color: string; icon: string }[] = [
    { key: 'heels', name: 'High heels', color: '#db2777', icon: '👠' },
    { key: 'hiphop', name: 'Hip-hop', color: '#7c3aed', icon: '🎧' },
    { key: 'contemp', name: 'Contemporary', color: '#0d9488', icon: '🩰' },
    { key: 'stretch', name: 'Растяжка', color: '#16a34a', icon: '🧘' },
    { key: 'kids', name: 'Детские группы', color: '#f59e0b', icon: '🧸' },
    { key: 'master', name: 'Мастер-классы', color: '#2563eb', icon: '⭐' },
]
// The abonements cover the regular classes; a master class is paid by ticket.
const REGULAR_DIRS: DirKey[] = ['heels', 'hiphop', 'contemp', 'stretch', 'kids']

const STAFF: readonly {
    key: StaffKey
    role: DemoRoleName
    account?: DemoAccountKey
    firstname: string
    lastname: string
    description: string
    manages?: DirKey
}[] = [
    { key: 'owner', role: 'admin', account: 'owner', firstname: 'Марина', lastname: 'Белова', description: 'Владелица и художественный руководитель студии' },
    { key: 'korolyova', role: 'coach', account: 'coach', firstname: 'Алина', lastname: 'Королёва', description: `${cap(VOCABULARY.coach.nom)} High heels и растяжки` },
    { key: 'orekhova', role: 'head_coach', firstname: 'Ксения', lastname: 'Орехова', description: `${cap(VOCABULARY.headCoach.nom)}: Contemporary и детские группы`, manages: 'kids' },
    { key: 'akhmetov', role: 'coach', firstname: 'Тимур', lastname: 'Ахметов', description: `${cap(VOCABULARY.coach.nom)} Hip-hop` },
]

const GROUPS: readonly GroupDef[] = [
    { key: 'heelsBeg', name: 'High heels · начинающие', dir: 'heels', gym: 'big', coach: 'korolyova', kind: 'adult', slots: [[2, '19:00', 60], [4, '19:00', 60]] },
    { key: 'heelsPro', name: 'High heels · продолжающие', dir: 'heels', gym: 'big', coach: 'korolyova', kind: 'adult', slots: [[1, '20:00', 75], [3, '20:00', 75], [6, '14:00', 75]] },
    { key: 'hipBeg', name: 'Hip-hop · с нуля', dir: 'hiphop', gym: 'small', coach: 'akhmetov', kind: 'adult', slots: [[1, '19:00', 60], [3, '19:00', 60]] },
    { key: 'contemp', name: 'Contemporary', dir: 'contemp', gym: 'big', coach: 'orekhova', kind: 'adult', slots: [[2, '20:15', 75], [4, '20:15', 75], [6, '12:00', 75]] },
    { key: 'kidsJunior', name: 'Дети 6–9 лет', dir: 'kids', gym: 'small', coach: 'orekhova', kind: 'kid', slots: [[2, '17:00', 45], [4, '17:00', 45], [6, '11:00', 45]] },
    { key: 'kidsTeen', name: 'Дети 10–13 лет · hip-hop', dir: 'kids', gym: 'small', coach: 'akhmetov', kind: 'kid', slots: [[1, '17:30', 60], [3, '17:30', 60], [6, '12:30', 60]] },
]
const ADULT_GROUPS = GROUPS.filter((g) => g.kind === 'adult').map((g) => g.key)

// «Растяжка» by booking (Group.bookingMode BOOKING): a student books a place
// one class at a time, a full class has a waitlist; Saturday has more places.
// No roster — any adult with an abonement books it.
const BOOKING_GROUP = {
    key: 'stretch',
    name: 'Растяжка · по записи',
    dir: 'stretch' as DirKey,
    gym: 'big' as GymKey,
    coach: 'korolyova' as StaffKey,
    capacity: 10,
    // [ISO weekday, start, minutes, places (null = the group's)]
    slots: [[1, '18:30', 60, null], [3, '18:30', 60, null], [6, '10:30', 60, 12]] as [number, string, number, number | null][],
    // Regulars who book it.
    regulars: 22,
}

const pack = (key: TariffKey, n: number, price: number, scope: string): TariffDef => ({
    key,
    name: countNoun(n, VOCABULARY.session),
    description: `${scope}, ${FROM_FIRST}`,
    price,
    classes: n,
    days: 30,
    dirs: REGULAR_DIRS,
    startsOnFirstVisit: true,
})

const TARIFFS: readonly TariffDef[] = [
    {
        key: 'trial',
        name: `Пробное ${VOCABULARY.session.nom}`,
        description: `Первое ${VOCABULARY.session.nom} бесплатно — в любой группе студии`,
        price: 0,
        classes: 1,
        days: 14,
        dirs: REGULAR_DIRS,
        isFreeTrial: true,
    },
    { ...pack('single', 1, 800, 'Любая группа'), name: `Разовое ${VOCABULARY.session.nom}` },
    pack('pack4', 4, 2800, 'Все направления'),
    pack('pack8', 8, 4800, 'Все направления'),
    { ...pack('pack12', 12, 6200, 'Все направления'), description: `Все направления, ${FROM_FIRST}. Самый выгодный` },
    { ...pack('kids8', 8, 4000, 'Детские группы'), name: `${countNoun(8, VOCABULARY.session)} · дети`, dirs: ['kids'] },
]

const COURSES: readonly {
    key: string
    title: string
    description: string
    dir: DirKey
    level: string
    chapters: [string, string[]][]
}[] = [
    {
        key: 'heels-basics',
        title: 'High heels: связки для начинающих',
        description: `Связки с ${VOCABULARY.session.ins} — повторяйте дома между ${VOCABULARY.session.insPl}.`,
        dir: 'heels',
        level: 'Начинающие',
        chapters: [
            ['Разогрев и шаги', ['Разминка на каблуках', 'Проходки и повороты']],
            ['Связки', ['Связка № 1 — восьмёрки', 'Связка № 2 — партер']],
        ],
    },
    {
        key: 'hiphop-groove',
        title: 'Hip-hop с нуля: грув и связки',
        description: 'Базовый грув, степы и короткие связки под музыку.',
        dir: 'hiphop',
        level: 'С нуля',
        chapters: [
            ['Грув', ['Bounce и rock']],
            ['Связки', ['Связка недели']],
        ],
    },
    {
        key: 'kids-concert',
        title: 'Детские группы: номер к отчётному концерту',
        description: 'Номер целиком и по частям — чтобы дети повторяли дома с родителями.',
        dir: 'kids',
        level: 'Дети',
        chapters: [['Номер', ['Начало номера', 'Финал номера']]],
    },
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

// Fisher–Yates over the given stream.
const shuffle = <T>(list: readonly T[], r: () => number): T[] => {
    const out = [...list]
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
}

// Placeholder numbers from the +7 900 2xx-xx-xx block (ACADEMY has 1xx), a
// bijection mod 10^6 so no two people share one.
const demoPhone = (n: number) => `+79002${String((n * 7919 + 104_729) % 1_000_000).padStart(6, '0')}`
const PARENT_PHONE_OFFSET = 10_000

export const buildRitmDemoPlan = (input: DemoPlanInput): DemoClubPlan => {
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
    const nextDow = (weekday: number, from = 1) => {
        let d = ahead(from)
        while (dow(d) !== weekday) d = addDaysYmd(d, 1)
        return d
    }
    const prevDow = (weekday: number) => {
        let d = ago(1)
        while (dow(d) !== weekday) d = addDaysYmd(d, -1)
        return d
    }
    const historyStart = ago(RITM_HISTORY_DAYS)
    const far = new Date(now.getTime() + FAR_FUTURE_DAYS * DAY_MS)

    const workspaceId = ritmId('workspace')
    const plan: DemoClubPlan = {
        workspaceId,
        workspace: {} as Prisma.WorkspaceCreateManyInput,
        joinCode: RITM_JOIN_CODE,
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

    // ---- ids ---------------------------------------------------------------
    const staffId = (k: StaffKey) => ritmId(`staff:${k}`)
    const gymId = (k: GymKey) => ritmId(`gym:${k}`)
    const dirId = (k: DirKey) => ritmId(`direction:${k}`)
    const groupId = (k: GroupKey) => ritmId(`group:${k}`)
    const slotId = (k: GroupKey, i: number) => ritmId(`slot:${k}:${i}`)
    const tariffId = (k: TariffKey) => ritmId(`plan:${k}`)
    const groupDef = (k: GroupKey) => GROUPS.find((g) => g.key === k) as GroupDef
    const tariffDef = (k: TariffKey) => TARIFFS.find((t) => t.key === k) as TariffDef
    const account = (k: DemoAccountKey) => RITM_ACCOUNTS.find((a) => a.key === k)!
    const ownerId = staffId('owner')

    // ---- studio ------------------------------------------------------------
    const clubCreatedYmd = ago(420)
    plan.workspace = {
        id: workspaceId,
        key: RITM_CLUB_KEY,
        name: RITM_CLUB_NAME,
        type: 'DANCE',
        isActive: true,
        isDemo: true,
        ownerId,
        timezone: tz,
        city: 'Томск',
        leaderboardEnabled: true,
        guestVisitsEnabled: false,
        ...defaultFeatureColumnsFor('DANCE'),
        // Placeholders: never a real number or link in the seed.
        aboutContacts: [
            { label: 'Администратор студии', phone: '+7 900 000-00-21' },
            { label: 'Детские группы', phone: '+7 900 000-00-22' },
        ],
        aboutLinks: [{ label: 'Сайт', url: 'https://ritm-studio.example' }],
        aboutRules:
            `Абонемент действует ${FROM_FIRST}. Пробное ${VOCABULARY.session.nom} — бесплатно, в любой группе. ` +
            'Приходите за 10 минут, на High heels — туфли на устойчивом каблуке и наколенники. ' +
            `Мастер-классы оплачиваются отдельно, абонемент на них не списывается.`,
        aboutUpdatedAt: at(ago(30), '12:00'),
        publicDescription:
            'Студия танца: High heels, Hip-hop, Contemporary, детские группы с 6 лет и мастер-классы приглашённых хореографов.',
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
        convertedAt: at(ago(300), '12:00'),
        autopayEnabled: false,
        notes: 'Демо-студия для показов: тариф бесплатно, все модули включены (docs/demo.md)',
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

    for (const g of GYMS) {
        plan.gyms.push({ id: gymId(g.key), workspaceId, name: g.name, address: g.address, createdAt: at(clubCreatedYmd, '10:00') })
    }
    DIRECTIONS.forEach((d, order) => {
        plan.directions.push({ id: dirId(d.key), workspaceId, name: d.name, color: d.color, icon: d.icon, order })
    })
    for (const d of REGULAR_DIRS) {
        plan.achievements.push(...defaultAchievementRows(workspaceId, dirId(d), VOCABULARY))
    }
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
            startsOnFirstVisit: t.startsOnFirstVisit ?? false,
        })
        for (const d of t.dirs) plan.planDirections.push({ planId: tariffId(t.key), directionId: dirId(d) })
    }

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
        const since = s.key === 'owner' ? clubCreatedYmd : ago(380 - i * 40)
        addUser({
            id: staffId(s.key),
            email: s.account ? account(s.account).email : `${translit(s.lastname)}@${RITM_EMAIL_DOMAIN}`,
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
        if (s.manages) plan.directionManagers.push({ workspaceId, directionId: dirId(s.manages), userId: staffId(s.key) })
    })

    const usedNames = new Set<string>([
        ...STAFF.map((s) => `${s.firstname} ${s.lastname}`),
        ...RITM_ACCOUNTS.map((a) => demoAccountName(a)),
        ...RITM_PARENT_CHILDREN.map((c) => `${c.firstname} ${c.lastname}`),
    ])
    const freshName = (female: boolean, firstNames: readonly string[]) => {
        for (;;) {
            const first = pick(firstNames)
            const male = pick(SURNAMES)
            const last = female ? femaleSurname(male) : male
            if (!usedNames.has(`${first} ${last}`)) {
                usedNames.add(`${first} ${last}`)
                return { first, last }
            }
        }
    }
    const persons: Person[] = []
    const addPerson = (p: Omit<Person, 'idx' | 'id' | 'subs' | 'visits' | 'email' | 'pauses'> & { email?: string | null }) => {
        const idx = persons.length + 1
        const person: Person = {
            ...p,
            idx,
            id: p.account ? ritmId(`account:${p.account}`) : ritmId(`person:${idx}`),
            email:
                p.email !== undefined
                    ? p.email
                    : p.kind === 'kid'
                      ? null
                      : `${translit(p.firstname)}.${translit(p.lastname)}.${idx}@${RITM_EMAIL_DOMAIN}`,
            subs: [],
            pauses: [],
            visits: 0,
        }
        persons.push(person)
        return person
    }

    // The fixed people of the demo script.
    const student = addPerson({
        firstname: account('student').firstname!,
        lastname: account('student').lastname,
        email: account('student').email,
        account: 'student',
        kind: 'adult',
        dob: ago(24 * 365 + 120),
        groups: ['heelsPro', 'contemp'],
        archetype: 'regular',
        joinYmd: ago(240),
        stopYmd: null,
        target: 2,
    })
    const parent = addPerson({
        firstname: account('parent').firstname!,
        lastname: account('parent').lastname,
        email: account('parent').email,
        account: 'parent',
        kind: 'adult',
        dob: ago(36 * 365 + 40),
        groups: ['heelsBeg'],
        archetype: 'regular',
        joinYmd: ago(150),
        stopYmd: null,
        target: 1,
    })
    const [sonya, vika] = RITM_PARENT_CHILDREN.map((c, i) =>
        addPerson({
            firstname: c.firstname,
            lastname: c.lastname,
            kind: 'kid',
            dob: ago((i === 0 ? 7 : 11) * 365 + 60),
            groups: [i === 0 ? 'kidsJunior' : 'kidsTeen'],
            archetype: 'regular',
            joinYmd: ago(i === 0 ? 130 : 200),
            stopYmd: null,
            target: 2,
        }),
    )
    const fixedPeople = new Set([student, parent, sonya, vika])

    // How many of each kind, so «Кто пропадает» holds about one in ten on any
    // day: those who stopped coming (one renewal not bought, one asked about
    // in the ИИ-чат), one coming less, a trial that did not convert, and the
    // newcomers — some of them not settled yet.
    const deck = (n: number, quotas: [Archetype, number][]) => {
        const cards = quotas.flatMap(([a, k]) => Array<Archetype>(k).fill(a))
        return shuffle([...cards, ...Array<Archetype>(n - cards.length).fill('regular')], rnd)
    }
    const adultDeck = deck(ADULTS - 2, [['lapsed', 2], ['declining', 1], ['trialOnly', 1], ['newcomer', 6]])
    const kidDeck = deck(KIDS - 2, [['declining', 1], ['newcomer', 2]])
    // A regular is past the newcomer's 90 days.
    const joinFor = (a: Archetype) =>
        a === 'newcomer' || a === 'trialOnly' ? ago(int(3, 40)) : ago(int(100, 600))
    for (let i = 0; i < ADULTS - 2; i++) {
        const female = rnd() < 0.88
        const name = freshName(female, female ? FEMALE_NAMES : MALE_NAMES)
        const archetype = adultDeck[i]
        const first = pick(female ? ADULT_GROUPS : (['hipBeg', 'contemp'] as GroupKey[]))
        const second = rnd() < 0.3 ? pick(ADULT_GROUPS.filter((g) => g !== first)) : null
        addPerson({
            firstname: name.first,
            lastname: name.last,
            kind: 'adult',
            dob: ago(int(18, 42) * 365 + int(0, 364)),
            groups: second ? [first, second] : [first],
            archetype,
            joinYmd: joinFor(archetype),
            stopYmd: archetype === 'lapsed' ? ago(int(20, 45)) : null,
            // Coming less shows only against a steady habit before.
            target: archetype === 'declining' ? int(2, 3) : int(1, 3),
        })
    }
    for (let i = 0; i < KIDS - 2; i++) {
        const female = rnd() < 0.75
        const name = freshName(female, female ? FEMALE_NAMES : MALE_NAMES)
        const age = int(6, 13)
        const archetype = kidDeck[i]
        addPerson({
            firstname: name.first,
            lastname: name.last,
            kind: 'kid',
            dob: ago(age * 365 + int(0, 364)),
            groups: [age <= 9 ? 'kidsJunior' : 'kidsTeen'],
            archetype,
            joinYmd: joinFor(archetype),
            stopYmd: archetype === 'lapsed' ? ago(int(20, 45)) : null,
            target: 2,
        })
    }
    // Those who left during the year: one in five after the free trial, a
    // third within two months, the rest after a season. The last of them left
    // six weeks ago, so none of it reads as today's risk.
    for (let i = 0; i < LEAVERS; i++) {
        const female = rnd() < 0.85
        const name = freshName(female, female ? FEMALE_NAMES : MALE_NAMES)
        const joinYmd = ago(int(90, 390))
        const r = rnd()
        const weeks = r < 0.2 ? 0 : r < 0.55 ? int(5, 10) : int(12, 30)
        // One who came for the trial had a week to come to it.
        const stop = addDaysYmd(joinYmd, weeks === 0 ? 7 : weeks * 7)
        const latest = ago(int(42, 56))
        addPerson({
            firstname: name.first,
            lastname: name.last,
            kind: 'adult',
            dob: ago(int(18, 42) * 365 + int(0, 364)),
            groups: [pick(female ? ADULT_GROUPS : (['hipBeg', 'contemp'] as GroupKey[]))],
            archetype: weeks === 0 ? 'trialOnly' : 'regular',
            joinYmd: joinYmd < latest ? joinYmd : latest,
            stopYmd: stop < latest ? stop : latest,
            left: true,
            target: int(1, 3),
        })
    }
    // Every two months of the window a regular may take a break.
    for (const p of persons) {
        if (fixedPeople.has(p) || p.left || p.archetype !== 'regular') continue
        for (let d = BREAK_WINDOW_DAYS[1]; d > BREAK_WINDOW_DAYS[0]; d -= 60) {
            const from = ago(d - int(0, 20))
            if (rnd() >= BREAK_SHARE || from <= addDaysYmd(p.joinYmd, 30)) continue
            p.pauses.push([from, addDaysYmd(from, int(28, 49))])
        }
    }

    // ---- groups and schedule -----------------------------------------------
    for (const g of GROUPS) {
        plan.groups.push({
            id: groupId(g.key),
            workspaceId,
            name: g.name,
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

    // ---- abonements and visits ---------------------------------------------
    // A member buys an abonement at the reception before the class that needs
    // one; it covers the regular directions, counted from that first class.
    const tariffFor = (p: Person): TariffDef => {
        if (p.kind === 'kid') return tariffDef('kids8')
        if (p === student) return tariffDef('pack8')
        if (p === parent) return tariffDef('pack4')
        if (p.target >= 3) return tariffDef('pack12')
        if (p.target === 2) return tariffDef('pack8')
        // Singles are for those who drop in now and then — and leave.
        return tariffDef(p.left && p.idx % 2 === 0 ? 'single' : 'pack4')
    }
    const buy = (p: Person, t: TariffDef, ymd: string, classTime: string): Sub => {
        const [h, m] = classTime.split(':').map(Number)
        const soldAt = new Date(at(ymd, classTime).getTime() - (15 + ((h * 60 + m + p.idx) % 20)) * 60_000)
        const startAt = t.startsOnFirstVisit ? at(ymd, '00:00') : soldAt
        const sub: Sub = {
            id: ritmId(`sub:${p.idx}:${p.subs.length}`),
            tariff: t,
            soldAt,
            startAt,
            endAt: t.startsOnFirstVisit ? at(addDaysYmd(ymd, t.days), '00:00') : new Date(startAt.getTime() + t.days * DAY_MS),
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
    // A bought-ahead abonement starts at its first class, or by itself
    // FIRST_VISIT_AUTO_START_DAYS after the sale (first-visit-start.ts).
    const startPending = (s: Sub, ymd: string) => {
        const auto = addDaysYmd(localDateInTz(s.soldAt, tz), FIRST_VISIT_AUTO_START_DAYS)
        const from = auto < ymd ? auto : ymd
        s.pending = false
        s.startAt = at(from, '00:00')
        s.endAt = at(addDaysYmd(from, s.tariff.days), '00:00')
    }
    const covering = (p: Person, dir: DirKey, instant: Date, ymd: string): Sub | null => {
        const live = p.subs.find(
            (s) => !s.pending && s.startAt <= instant && instant < s.endAt && s.remaining > 0 && s.tariff.dirs.includes(dir),
        )
        if (live) return live
        const next = p.subs.find((s) => s.pending && s.soldAt <= instant && s.tariff.dirs.includes(dir))
        if (!next) return null
        startPending(next, ymd)
        // Started by itself and ran out unused: look again.
        return next.endAt > instant ? next : covering(p, dir, instant, ymd)
    }
    // A student keeps a habit: `target` classes of her groups a week she
    // almost never misses, the others now and then.
    const habits = new Map<Person, Set<string>>()
    const habitOf = (p: Person) => {
        let set = habits.get(p)
        if (!set) {
            const mine = p.groups.flatMap((k) => groupDef(k).slots.map((_, i) => `${k}:${i}`))
            const turn = p.idx % mine.length
            set = new Set([...mine.slice(turn), ...mine.slice(0, turn)].slice(0, p.target))
            habits.set(p, set)
        }
        return set
    }
    const chance = (p: Person, ymd: string, group: GroupKey, slot: number): number => {
        if (ymd < p.joinYmd || (p.stopYmd && ymd > p.stopYmd)) return 0
        if (p.pauses.some(([from, until]) => ymd >= from && ymd < until)) return 0
        if (p.archetype === 'trialOnly') return p.visits === 0 ? 0.95 : 0
        // The people of the demo script never miss their days: Дарья Monday
        // High heels and Tuesday Contemporary, Ирина Tuesday, the girls the
        // first two classes of their group.
        if (fixedPeople.has(p)) return slot < p.target / p.groups.length ? 1 : 0
        const base = habitOf(p).has(`${group}:${slot}`) ? 0.85 : 0.05
        if (p.archetype === 'declining' && ymd >= ago(21)) return base * 0.1
        // Who books «Растяжка» (below) trades one of her classes a week for it.
        if (ymd >= ago(21) && bookers.includes(p)) return (base * p.target) / (p.target + 1)
        return base
    }
    // Renews ahead after this class: a regular (a newcomer too, after the
    // trial) whose abonement is used up or ends within the week — never just
    // before a break or on the way out, never a single.
    const renewsAhead = (p: Person, sub: Sub, ymd: string, startAt: Date) =>
        !fixedPeople.has(p) &&
        !p.left &&
        (p.archetype === 'regular' || p.archetype === 'newcomer') &&
        sub.tariff.key !== 'single' &&
        !p.subs.some((s) => s.pending) &&
        (sub.remaining === 0 || sub.endAt.getTime() - startAt.getTime() < 7 * DAY_MS) &&
        !p.pauses.some(([from]) => ymd < from && addDaysYmd(ymd, 21) >= from) &&
        rnd() < RENEW_AHEAD_SHARE
    const recordVisit = (p: Person, sessionId: string, markedById: string, startAt: Date, sub: Sub | null) => {
        if (sub) sub.remaining -= 1
        p.visits += 1
        plan.records.push({
            sessionId,
            workspaceId,
            userId: p.id,
            markedById,
            markedAt: new Date(startAt.getTime() + int(3, 15) * 60_000),
            usedSubscriptionId: sub?.id ?? null,
            consumedSubscriptionId: sub?.id ?? null,
        })
    }
    const lastVisit = new Map<string, string>()

    // ---- «Растяжка» by booking ------------------------------------------------
    // The last three weeks are settled inside the history, in order, the way
    // the sweep settles a class: attended (charged like any visit), a no-show
    // and a late cancel (the pack loses a class — the studio's burn switches
    // are on by default), a place freed in time going to the first on the
    // waitlist. The next week is open (below, after the freezes): full classes
    // with a waitlist, others with places left; Дарья (student@) holds a place
    // in the nearest class, Ирина (parent@) is first on its waitlist. Its own
    // rng for the choices. Window and free-cancel deadline: the defaults of
    // Workspace.bookingWindowDays / bookingCancelHours.
    const BOOKING_WINDOW_DAYS = 14
    const BOOKING_CANCEL_HOURS = 12
    const brnd = makeRng(SEED + 1)
    const bint = (a: number, b: number) => a + Math.floor(brnd() * (b - a + 1))
    const bg = BOOKING_GROUP
    const bgId = ritmId(`group:${bg.key}`)
    const bgSlotId = (i: number) => ritmId(`slot:${bg.key}:${i}`)
    const bgCoachId = staffId(bg.coach)
    plan.groups.push({
        id: bgId,
        workspaceId,
        name: bg.name,
        gymId: gymId(bg.gym),
        directionId: dirId(bg.dir),
        coachId: bgCoachId,
        bookingMode: 'BOOKING',
        capacity: bg.capacity,
        createdAt: at(ago(60), '11:00'),
    })
    plan.groupCoaches.push({ groupId: bgId, userId: bgCoachId, role: 'primary' })
    bg.slots.forEach(([dayOfWeek, startTime, durationMin, capacity], i) => {
        plan.slots.push({ id: bgSlotId(i), groupId: bgId, dayOfWeek, startTime, durationMin, capacity })
    })
    const bookers = shuffle(
        persons.filter((p) => !p.left && !fixedPeople.has(p) && p.kind === 'adult' && p.archetype === 'regular'),
        brnd,
    ).slice(0, bg.regulars)
    type BookedClass = { i: number; j: number; ymd: string; startAt: Date; endAt: Date; capacity: number; key: string }
    const bookedClasses: BookedClass[] = []
    for (let ymd = ago(21), past = 0, open = 0; ymd <= ahead(7); ymd = addDaysYmd(ymd, 1)) {
        bg.slots.forEach(([day, time, min, places], i) => {
            const startAt = at(ymd, time)
            // Today's class once it has begun: neither settled nor open.
            if (day !== dow(ymd) || (ymd >= today && startAt <= now)) return
            const j = startAt < now ? past++ : open++
            const key = scheduledOccurrenceKey(bgSlotId(i), ymd)
            bookedClasses.push({ i, j, ymd, startAt, endAt: new Date(startAt.getTime() + min * 60_000), capacity: places ?? bg.capacity, key })
        })
    }
    const bookingRow = (
        c: BookedClass,
        p: Person,
        createdAt: number,
        status: Prisma.ClassBookingCreateManyInput['status'],
        extra: Partial<Prisma.ClassBookingCreateManyInput> = {},
    ) =>
        plan.classBookings.push({
            id: ritmId(`booking:${c.key}:${p.id}`),
            workspaceId,
            occurrenceId: ritmId(`class:${c.key}`),
            userId: p.id,
            status,
            bookedById: p.id,
            createdAt: new Date(createdAt),
            ...extra,
        })
    const occurrence = (c: BookedClass, createdAt: number, settledAt: Date | null) =>
        plan.classOccurrences.push({
            id: ritmId(`class:${c.key}`),
            workspaceId,
            groupId: bgId,
            slotId: bgSlotId(c.i),
            sessionDate: ymdToDbDate(c.ymd),
            occurrenceKey: c.key,
            startAt: c.startAt,
            endAt: c.endAt,
            settledAt,
            createdAt: new Date(createdAt),
        })
    // Booked in the days before, in this order (the waitlist goes by it).
    const bookingTimes = (n: number, from: number, until: number) =>
        Array.from({ length: n }, () => from + brnd() * (until - from)).sort((a, b) => a - b)
    const runningStretch = (p: Person, instant: Date) =>
        p.subs.find((s) => !s.pending && s.tariff.dirs.includes(bg.dir) && s.remaining > 0 && s.startAt <= instant && instant < s.endAt)
    // The burn of a late cancel / no-show: one class off the running pack.
    const burn = (p: Person, instant: Date) => {
        const s = runningStretch(p, instant)
        if (!s) return { classBurned: false, burnedSubscriptionId: null }
        s.remaining -= 1
        return { classBurned: true, burnedSubscriptionId: s.id }
    }
    const settle = (c: BookedClass) => {
        const { j } = c
        const deadline = c.startAt.getTime() - BOOKING_CANCEL_HOURS * 60 * 60_000
        const full = j % 3 !== 2
        const holders = full ? c.capacity : c.capacity - bint(2, 4)
        // A full class every other time had someone waiting.
        const queue = full && j % 2 === 0 ? bint(1, 2) : 0
        const people = shuffle(
            bookers.filter(
                (p) =>
                    !p.pauses.some(([from, until]) => c.ymd >= from && c.ymd < until) &&
                    (runningStretch(p, c.startAt) || p.subs.some((s) => s.pending && s.soldAt <= c.startAt)),
            ),
            brnd,
        ).slice(0, holders + queue)
        const times = bookingTimes(people.length, c.startAt.getTime() - 6 * DAY_MS, deadline - 60 * 60_000)
        occurrence(c, times[0] ?? c.startAt.getTime() - 6 * DAY_MS, new Date(c.endAt.getTime() + (120 + bint(1, 4)) * 60_000))
        const holding = people.slice(0, holders).map((p, k) => ({ p, createdAt: times[k], promotedAt: null as Date | null }))
        const queued = people.slice(holders).map((p, k) => ({ p, createdAt: times[holders + k] }))
        // A place given up in time goes to the first on the waitlist.
        if (queued.length > 0) {
            const gaveUp = holding[0]
            const cancelledAt = new Date(queued[0].createdAt + brnd() * (deadline - 30 * 60_000 - queued[0].createdAt))
            bookingRow(c, gaveUp.p, gaveUp.createdAt, 'CANCELLED', { cancelledAt })
            holding.splice(0, 1, { ...queued.shift()!, promotedAt: cancelledAt })
        }
        for (const q of queued) bookingRow(c, q.p, q.createdAt, 'EXPIRED')
        const late = j % 4 === 1 ? holding.at(-1)?.p : undefined
        const noShow = j % 2 === 0 ? holding[1]?.p : undefined
        const sessionId = ritmId(`session:${bg.key}:${c.i}:${c.ymd}`)
        let attended = 0
        for (const { p, createdAt, promotedAt } of holding) {
            if (p === late) {
                const cancelledAt = new Date(deadline + brnd() * (c.startAt.getTime() - 30 * 60_000 - deadline))
                bookingRow(c, p, createdAt, 'LATE_CANCELLED', { promotedAt, cancelledAt, ...burn(p, c.startAt) })
                continue
            }
            if (p === noShow) {
                bookingRow(c, p, createdAt, 'NO_SHOW', { promotedAt, ...burn(p, c.startAt) })
                continue
            }
            const sub = covering(p, bg.dir, c.startAt, c.ymd)
            recordVisit(p, sessionId, bgCoachId, c.startAt, sub)
            lastVisit.set(p.id, c.ymd)
            if (sub && renewsAhead(p, sub, c.ymd, c.startAt)) {
                const next = buy(p, tariffFor(p), c.ymd, '10:00')
                next.soldAt = new Date(c.endAt.getTime() + (5 + (p.idx % 10)) * 60_000)
                next.pending = true
            }
            bookingRow(c, p, createdAt, 'ATTENDED', { promotedAt })
            attended += 1
        }
        if (attended > 0) {
            plan.sessions.push({
                id: sessionId,
                workspaceId,
                groupId: bgId,
                slotId: bgSlotId(c.i),
                sessionDate: ymdToDbDate(c.ymd),
                occurrenceKey: c.key,
                title: bg.name,
                startAt: c.startAt,
                timezone: tz,
                coachId: bgCoachId,
                createdById: bgCoachId,
                createdAt: c.startAt,
            })
        }
    }

    for (let ymd = historyStart; ymd < today; ymd = addDaysYmd(ymd, 1)) {
        const weekday = dow(ymd)
        for (const c of bookedClasses) if (c.ymd === ymd && c.startAt < now) settle(c)
        for (const g of GROUPS) {
            g.slots.forEach(([day, time], i) => {
                if (day !== weekday) return
                const startAt = at(ymd, time)
                const sessionId = ritmId(`session:${g.key}:${i}:${ymd}`)
                const before = plan.records.length
                for (const p of persons) {
                    if (!p.groups.includes(g.key) || rnd() >= chance(p, ymd, g.key, i)) continue
                    let sub = covering(p, g.dir, startAt, ymd)
                    if (!sub) {
                        const first = p.subs.length === 0 && (p.archetype === 'newcomer' || p.archetype === 'trialOnly' || !!p.left)
                        sub = buy(p, first ? tariffDef('trial') : tariffFor(p), ymd, time)
                    }
                    recordVisit(p, sessionId, staffId(g.coach), startAt, sub)
                    lastVisit.set(p.id, ymd)
                    if (renewsAhead(p, sub, ymd, startAt)) {
                        const next = buy(p, tariffFor(p), ymd, time)
                        // At the reception after the class.
                        next.soldAt = new Date(startAt.getTime() + (groupDef(g.key).slots[i][2] + 5 + (p.idx % 10)) * 60_000)
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
    // The fixed people always hold a running abonement with classes left.
    for (const p of fixedPeople) {
        const live = liveSub(p)
        if (!live || live.remaining === 0) buy(p, tariffFor(p), ago(int(3, 8)), '18:00').remaining = tariffFor(p).classes - 1
    }
    // Three paid at the next visit — «Долги» has someone to show.
    persons
        .filter((p) => !fixedPeople.has(p) && !p.left && p.archetype === 'regular' && p.kind === 'adult')
        .slice(0, 3)
        .forEach((p) => {
            const last = p.subs.at(-1)
            if (last && last.tariff.price > 0) last.isPaid = false
        })
    // The rest of those whose abonement ends soon by days renew the same way
    // in the last days, so only part of the studio shows in «К продлению» and
    // «Доступ истекает», as in a healthy studio.
    for (const p of persons) {
        if (fixedPeople.has(p) || p.archetype !== 'regular' || p.stopYmd || p.subs.some((s) => s.pending)) continue
        const live = liveSub(p)
        if (!live || live.tariff.isFreeTrial || rnd() >= 0.8) continue
        const daysLeft = (live.endAt.getTime() - now.getTime()) / DAY_MS
        // The same moment as at the reception after a class: a week left or
        // the pack used up — not earlier, so the last weeks don't spike.
        if (daysLeft > 7 && live.remaining > 0) continue
        const t = live.tariff.key === 'single' ? tariffDef('pack4') : live.tariff
        // After the last visit (a visit since would have started it), on one
        // of the last days, never today.
        const drawn = ago(int(1, 3))
        const last = lastVisit.get(p.id) ?? ''
        const saleYmd = drawn > last ? drawn : last
        const next = buy(p, t, saleYmd, '21:30')
        next.pending = true
        next.endAt = at(addDaysYmd(saleYmd, FIRST_VISIT_AUTO_START_DAYS + t.days), '00:00')
    }

    // ---- a freeze and a freeze request ----------------------------------------
    // One on holiday with her abonement frozen; one asking to freeze from next
    // week — her group is Королёва's, so pedagog@ decides it on the home screen.
    const members = persons.filter((p) => !p.left)
    const steady = members.filter((p) => {
        if (fixedPeople.has(p) || p.archetype !== 'regular' || p.kind !== 'adult') return false
        if (p.subs.some((s) => s.pending)) return false
        const s = liveSub(p)
        return (
            !!s &&
            !s.tariff.isFreeTrial &&
            s.isPaid &&
            s.startAt.getTime() <= now.getTime() - 3 * DAY_MS &&
            s.endAt.getTime() > now.getTime() + 6 * DAY_MS &&
            s.remaining > 2
        )
    })
    const ofPedagog = (p: Person) => p.groups.some((g) => groupDef(g).coach === 'korolyova')
    const frozen = steady.find((p) => !ofPedagog(p)) ?? steady[0]
    const requester = steady.find((p) => p !== frozen && ofPedagog(p))
    if (frozen) {
        plan.liveFreezes.push({ userId: frozen.id, subscriptionId: liveSub(frozen)!.id, days: 14, reason: 'Отпуск' })
    }
    if (requester) {
        const s = liveSub(requester)!
        plan.freezeRequests.push({
            workspaceId,
            subscriptionId: s.id,
            userId: requester.id,
            pendingSubscriptionId: s.id,
            status: 'PENDING',
            fromDate: ymdToDbDate(ahead(3)),
            days: 10,
            reason: 'Командировка в Новосибирск',
            createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000),
        })
    }
    const onHold = new Set([frozen, requester])

    // «Растяжка» ahead: open for booking. Packs are not over-promised — live
    // bookings stay within the classes left, a pack bought ahead counts.
    const liveAhead = new Map<string, number>()
    const canBook = (p: Person, startAt: Date) => {
        const left = p.subs
            .filter((s) => s.tariff.dirs.includes(bg.dir) && s.remaining > 0 && (s.pending || (s.startAt <= startAt && startAt < s.endAt)))
            .reduce((n, s) => n + s.remaining, 0)
        return (liveAhead.get(p.id) ?? 0) < left
    }
    for (const c of bookedClasses.filter((x) => x.startAt > now)) {
        const full = c.j % 2 === 0
        const holders = full ? c.capacity : c.capacity - bint(2, 4)
        const queue = full ? bint(2, 3) : 0
        const people = shuffle(
            bookers.filter((p) => !onHold.has(p) && canBook(p, c.startAt)),
            brnd,
        ).slice(0, holders + queue)
        if (c.j === 0) {
            if (canBook(student, c.startAt)) people.splice(0, 0, student)
            if (canBook(parent, c.startAt)) people.splice(Math.min(holders, people.length), 0, parent)
        }
        const from = Math.max(at(addDaysYmd(c.ymd, -BOOKING_WINDOW_DAYS), '00:00').getTime(), now.getTime() - 5 * DAY_MS)
        const times = bookingTimes(people.length, from, now.getTime() - 20 * 60_000)
        occurrence(c, times[0] ?? from, null)
        people.forEach((p, k) => {
            bookingRow(c, p, times[k], k < holders ? 'BOOKED' : 'WAITLISTED')
            if (k < holders) liveAhead.set(p.id, (liveAhead.get(p.id) ?? 0) + 1)
        })
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
                workspaceMemberId: p.left ? null : ritmId(`member:${p.idx}`),
                userId: p.id,
                source: 'MANUAL',
                createdAt: s.soldAt,
            })
            for (const d of s.tariff.dirs) plan.subscriptionDirections.push({ subscriptionId: s.id, directionId: dirId(d) })
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
            // A child has no phone of its own: the studio calls the parents.
            phone: p.kind === 'kid' ? null : demoPhone(p.idx),
        })
        if (p.account) plan.accountUserIds[p.account] = p.id
        if (p.left) continue
        plan.members.push({
            role: 'user',
            data: {
                id: ritmId(`member:${p.idx}`),
                userId: p.id,
                workspaceId,
                status: 'ACTIVE',
                accessUntil: p.subs.reduce<Date | null>((max, s) => (!max || s.endAt > max ? s.endAt : max), null),
                createdAt: at(p.joinYmd, '12:00'),
                lastSeenAt: at(seen, '20:00'),
                notificationsMuted: !p.account,
            },
        })
        for (const k of p.groups) {
            plan.groupMembers.push({ groupId: groupId(k), userId: p.id, joinedAt: at(p.joinYmd, '12:00') })
        }
    }

    const confirmGuardian = (guardianId: string, child: Person, invitedByClub: boolean) => {
        plan.guardianships.push({
            guardianId,
            dependentId: child.id,
            relation: 'PARENT',
            invitedByWorkspaceId: invitedByClub ? workspaceId : null,
            invitedById: invitedByClub ? ownerId : null,
            consentAt: at(child.joinYmd, '19:00'),
            consentVersion: GUARDIAN_CONSENT_VERSION,
            createdAt: at(child.joinYmd, '18:00'),
        })
        plan.consents.push({
            userId: guardianId,
            kind: 'DEPENDENT_DATA',
            version: GUARDIAN_CONSENT_VERSION,
            acceptedAt: at(child.joinYmd, '19:00'),
            dependentId: child.id,
        })
    }
    confirmGuardian(parent.id, sonya, false)
    confirmGuardian(parent.id, vika, false)
    persons
        .filter((p) => p.kind === 'kid' && !fixedPeople.has(p))
        .forEach((kid, i) => {
            const female = rnd() < 0.8
            const base = kid.lastname.endsWith('а') ? kid.lastname.slice(0, -1) : kid.lastname
            const parentId = ritmId(`parent:${kid.idx}`)
            const first = pick(female ? FEMALE_NAMES : MALE_NAMES)
            addUser({
                id: parentId,
                email: `${translit(first)}.${translit(base)}.parent${kid.idx}@${RITM_EMAIL_DOMAIN}`,
                firstname: first,
                lastname: female ? femaleSurname(base) : base,
                createdYmd: kid.joinYmd,
                phone: demoPhone(PARENT_PHONE_OFFSET + kid.idx),
            })
            if (i < CONFIRMED_PARENTS) {
                confirmGuardian(parentId, kid, true)
            } else {
                plan.guardianships.push({
                    guardianId: parentId,
                    dependentId: kid.id,
                    relation: 'PARENT',
                    invitedByWorkspaceId: workspaceId,
                    invitedById: ownerId,
                    consentAt: null,
                    createdAt: at(kid.joinYmd, '18:00'),
                })
            }
        })

    // ---- master classes and the concert --------------------------------------
    // Paid by ticket (EventRegistration), never from an abonement. The past one
    // was full and paid; the next one is full with a waitlist — Ирина (parent@)
    // first in line, Дарья (student@) holding a place.
    const adults = persons.filter((p) => p.kind === 'adult' && !p.stopYmd && p.archetype !== 'trialOnly')
    const pastMc = { key: 'mc-vogue', ymd: prevDow(6), time: '16:00', price: 1500, capacity: 14 }
    const nextMc = { key: 'mc-dancehall', ymd: nextDow(6, 3), time: '15:00', price: 1800, capacity: 16 }
    const events = [
        {
            key: pastMc.key,
            title: 'Мастер-класс: Vogue',
            description: 'Вог-дуэли, руки и подача. Для всех уровней.',
            ymd: pastMc.ymd,
            time: pastMc.time,
            hours: 2,
            hostName: 'Ева Лирова, приглашённый хореограф',
            price: pastMc.price,
            capacity: pastMc.capacity,
            dir: 'master' as DirKey,
            coach: null,
        },
        {
            key: nextMc.key,
            title: 'Мастер-класс: dancehall',
            description: 'Два часа dancehall с приглашённым хореографом: база, грув и связка. Нужны удобная обувь и наколенники.',
            ymd: nextMc.ymd,
            time: nextMc.time,
            hours: 2,
            hostName: 'Ника Сафонова, приглашённый хореограф',
            price: nextMc.price,
            capacity: nextMc.capacity,
            dir: 'master' as DirKey,
            coach: null,
        },
        {
            key: 'concert',
            title: 'Отчётный концерт студии',
            description: 'Выступают все группы, дети — в первом отделении. Вход для родных и друзей свободный.',
            ymd: ahead(24),
            time: '18:00',
            hours: 2,
            hostName: null,
            price: null,
            capacity: null,
            dir: null,
            coach: 'orekhova' as StaffKey,
        },
    ]
    for (const e of events) {
        const startAt = at(e.ymd, e.time)
        plan.events.push({
            id: ritmId(`event:${e.key}`),
            workspaceId,
            title: e.title,
            description: e.description,
            startAt,
            endAt: new Date(startAt.getTime() + e.hours * 60 * 60 * 1000),
            timezone: tz,
            gymId: gymId('big'),
            directionId: e.dir ? dirId(e.dir) : null,
            coachId: e.coach ? staffId(e.coach) : null,
            hostName: e.hostName,
            price: e.price,
            currency: 'RUB',
            capacity: e.capacity,
            createdById: ownerId,
            createdAt: at(addDaysYmd(e.ymd, -14) < today ? addDaysYmd(e.ymd, -14) : ago(1), '11:00'),
        })
    }
    const register = (
        eventKey: string,
        p: Person,
        createdAt: Date,
        status: Prisma.EventRegistrationCreateManyInput['status'],
        paid: { price: number; at: Date; method: 'CASH' | 'TRANSFER' } | null,
        extra: Partial<Prisma.EventRegistrationCreateManyInput> = {},
    ) =>
        plan.eventRegistrations.push({
            id: ritmId(`registration:${eventKey}:${p.idx}`),
            workspaceId,
            eventId: ritmId(`event:${eventKey}`),
            userId: p.id,
            status,
            bookedById: p.id,
            createdAt,
            isPaid: paid !== null,
            paidAt: paid?.at ?? null,
            amountPaid: paid?.price ?? null,
            currency: paid ? 'RUB' : null,
            paymentMethod: paid?.method ?? null,
            markedPaidById: paid ? ownerId : null,
            ...extra,
        })
    // The past master class: every place taken and paid, one place given up
    // in time went to the waitlist; those who came are marked.
    {
        const startAt = at(pastMc.ymd, pastMc.time)
        const from = startAt.getTime() - 12 * DAY_MS
        const pool = adults.filter((p) => p !== parent).slice(0, pastMc.capacity + 1)
        const sessionId = ritmId(`session:${pastMc.key}`)
        const eventId = ritmId(`event:${pastMc.key}`)
        pool.forEach((p, k) => {
            const createdAt = new Date(from + k * 7 * 60 * 60_000)
            const paidAt = new Date(createdAt.getTime() + DAY_MS)
            if (k === 2) {
                register(pastMc.key, p, createdAt, 'CANCELLED', null, { cancelledAt: new Date(startAt.getTime() - 2 * DAY_MS) })
                return
            }
            const promoted = k === pastMc.capacity ? { promotedAt: new Date(startAt.getTime() - 2 * DAY_MS) } : {}
            register(pastMc.key, p, createdAt, 'BOOKED', { price: pastMc.price, at: paidAt, method: k % 3 === 0 ? 'TRANSFER' : 'CASH' }, promoted)
            if (k % 7 !== 5) recordVisit(p, sessionId, ownerId, startAt, null)
        })
        plan.sessions.push({
            id: sessionId,
            workspaceId,
            workspaceEventId: eventId,
            occurrenceKey: eventOccurrenceKey(eventId),
            title: 'Мастер-класс: Vogue',
            startAt,
            timezone: tz,
            createdById: ownerId,
            createdAt: startAt,
        })
    }
    // The next one: full, three on the waitlist (Ирина first), one cancelled.
    {
        const from = now.getTime() - 6 * DAY_MS
        const others = adults.filter((p) => p !== student && p !== parent)
        const booked = [student, ...others.slice(3, 3 + nextMc.capacity - 1)]
        booked.forEach((p, k) => {
            const createdAt = new Date(from + k * 5 * 60 * 60_000)
            const paid = k % 4 === 3 ? null : { price: nextMc.price, at: new Date(createdAt.getTime() + 3 * 60 * 60_000), method: k % 2 === 0 ? ('CASH' as const) : ('TRANSFER' as const) }
            register(nextMc.key, p, createdAt, 'BOOKED', paid)
        })
        const queueFrom = from + booked.length * 5 * 60 * 60_000
        ;[parent, others[nextMc.capacity + 3], others[nextMc.capacity + 4]].forEach((p, k) => {
            register(nextMc.key, p, new Date(Math.min(queueFrom + k * 2 * 60 * 60_000, now.getTime() - 60 * 60_000)), 'WAITLISTED', null)
        })
        const gaveUp = others[nextMc.capacity + 5]
        register(nextMc.key, gaveUp, new Date(from - 60 * 60_000), 'CANCELLED', null, { cancelledAt: new Date(from + 30 * 60_000) })
    }

    // ---- announcements ---------------------------------------------------------
    const announce = (
        by: StaffKey,
        title: string,
        body: string,
        daysAgo: number,
        extra: { pinned?: boolean; dir?: DirKey; groups?: GroupKey[]; expiring?: boolean } = {},
    ) => {
        const id = ritmId(`announcement:${plan.announcements.length}`)
        plan.announcements.push({
            id,
            workspaceId,
            authorId: staffId(by),
            title,
            body,
            pinned: extra.pinned ?? false,
            audience: extra.expiring ? 'EXPIRING' : 'ALL',
            directionId: extra.dir ? dirId(extra.dir) : null,
            publishedAt: at(ago(daysAgo), '10:00'),
            createdAt: at(ago(daysAgo), '09:30'),
        })
        for (const key of extra.groups ?? []) plan.announcementGroups.push({ announcementId: id, groupId: groupId(key) })
    }
    const ddmm = (ymd: string) => ymd.split('-').reverse().slice(0, 2).join('.')
    announce('owner', `Мастер-класс по dancehall — ${ddmm(nextMc.ymd)}`, `Ведёт приглашённый хореограф. ${nextMc.capacity} мест, ${nextMc.price} ₽ — запись в приложении, раздел «События». Мест нет — встаньте в лист ожидания: освободится место, придёт уведомление.`, 2, { pinned: true })
    announce('owner', `Отчётный концерт — ${ddmm(ahead(24))}`, 'Выступают все группы. Костюмы обсуждаем на ближайших занятиях, генеральная репетиция — в субботу перед концертом.', 5)
    announce('korolyova', 'Каблуки на занятие', `Берите туфли на устойчивом каблуке и наколенники. Новые связки — в «Видео» после каждого ${VOCABULARY.session.gen}.`, 8, { dir: 'heels' })
    announce('orekhova', 'Родителям: детские группы на каникулах', 'Расписание детских групп на каникулах не меняется. Номер к концерту можно повторять дома — видео в приложении.', 4, { groups: ['kidsJunior', 'kidsTeen'] })
    announce('owner', 'Ваш абонемент скоро закончится', `Продлите абонемент — и следующее ${VOCABULARY.session.nom} пройдёт без перерыва.`, 1, { expiring: true })
    announce('korolyova', 'Растяжка — по записи', `В группе ${bg.capacity} мест, в субботу — 12. Записывайтесь в приложении на каждое ${VOCABULARY.session.acc}; мест нет — встаньте в лист ожидания. Отменить запись без списания можно за ${BOOKING_CANCEL_HOURS} часов.`, 6, { dir: 'stretch' })

    // ---- a substitution ahead ---------------------------------------------------
    // Орехова is away: Королёва (pedagog@) takes her next Contemporary —
    // Дарья (student@) is in the group and sees «Замена: А. Королёва».
    {
        const g = groupDef('contemp')
        const slot = g.slots
            .map((s, i) => ({ i, ymd: nextDow(s[0]) }))
            .reduce((a, b) => (b.ymd < a.ymd ? b : a))
        const createdAt = new Date(now.getTime() - 26 * 60 * 60 * 1000)
        plan.classSubstitutions.push({
            id: ritmId(`substitution:${g.key}:${slot.i}`),
            workspaceId,
            groupId: groupId(g.key),
            slotId: slotId(g.key, slot.i),
            sessionDate: ymdToDbDate(slot.ymd),
            occurrenceKey: scheduledOccurrenceKey(slotId(g.key, slot.i), slot.ymd),
            substituteId: staffId('korolyova'),
            status: 'APPROVED',
            kind: 'ASSIGN',
            requestedById: staffId('orekhova'),
            decidedById: staffId('orekhova'),
            decidedAt: createdAt,
            createdAt,
        })
    }

    // ---- videos of combinations (placeholders) ---------------------------------
    COURSES.forEach((c, ci) => {
        const courseId = ritmId(`course:${c.key}`)
        plan.courses.push({
            id: courseId,
            workspaceId,
            title: c.title,
            slug: c.key,
            description: c.description,
            level: c.level,
            publishedAt: at(ago(60 - ci * 10), '10:00'),
            createdAt: at(ago(62 - ci * 10), '10:00'),
        })
        plan.courseAudiences.push({ courseId, kind: 'DIRECTION', directionId: dirId(c.dir) })
        let order = 0
        c.chapters.forEach(([title, lessons], chi) => {
            const chapterId = ritmId(`chapter:${c.key}:${chi}`)
            plan.chapters.push({ id: chapterId, courseId, title, order: chi })
            lessons.forEach((lesson, li) => {
                const videoId = ritmId(`video:${c.key}:${chi}:${li}`)
                // No media in the demo: «processing» renders as «видео
                // обрабатывается»; `npm run demo:videos` uploads real clips.
                plan.videos.push({
                    id: videoId,
                    workspaceId,
                    title: lesson,
                    description: `${c.title} — ${title}`,
                    url: '',
                    status: 'processing',
                    createdAt: at(ago(62 - ci * 10), '10:00'),
                })
                plan.courseVideos.push({ courseId, videoId, order: order++, lessonTitle: lesson, chapterId })
            })
        })
    })

    // ---- the rest: a call noted, the student's journal, the audit trail ----------
    const lapsedMembers = members.filter((p) => p.archetype === 'lapsed' && p.kind === 'adult' && lastVisit.has(p.id))
    const called = lapsedMembers[1]
    if (called) {
        plan.retentionContacts.push({
            workspaceId,
            userId: called.id,
            contactedById: ownerId,
            reason: 'call',
            signals: ['lapsed', 'absent'],
            note: 'Позвонили: уезжала к родителям, продлит абонемент на следующей неделе',
            createdAt: at(ago(3), '15:00'),
        })
    }
    const journal: [number, string][] = [
        [1, 'Contemporary: связка с партером получилась целиком, но в переходе с пола опаздываю на счёт.'],
        [4, 'High heels: восьмёрки стали ровнее. Повторить «Связку № 1» по видео перед субботой.'],
        [11, 'Первый раз станцевала связку под музыку без остановок!'],
    ]
    for (const [d, body] of journal) {
        plan.journal.push({ workspaceId, userId: student.id, entryDate: ymdToDbDate(ago(d)), body, createdAt: at(ago(d), '22:00') })
    }
    const audit = (action: string, targetType: string, targetId: string, createdAt: Date, metadata?: Prisma.InputJsonValue) =>
        plan.auditEvents.push({
            workspaceId,
            actorId: ownerId,
            actorEmail: account('owner').email,
            action,
            targetType,
            targetId,
            metadata,
            createdAt,
        })
    members
        .flatMap((p) => p.subs.filter((s) => s.soldAt <= now).map((s) => ({ p, s })))
        .sort((a, b) => b.s.soldAt.getTime() - a.s.soldAt.getTime())
        .slice(0, 5)
        .forEach(({ p, s }) => audit('member.assignSubscription', 'member', p.id, s.soldAt, { planName: s.tariff.name }))
    audit('event.create', 'event', ritmId(`event:${nextMc.key}`), at(addDaysYmd(nextMc.ymd, -14) < today ? addDaysYmd(nextMc.ymd, -14) : ago(1), '11:00'), {
        title: 'Мастер-класс: dancehall',
    })

    // ---- ИИ-чат in the admin ------------------------------------------------------
    // Turned on by the owner a week ago, and her saved question «Кому позвонить
    // сегодня?» — the model's side pseudonymized exactly as a live turn would
    // be, one student per risk reason, their groups as chips. The question
    // counts against the monthly limit, as a live one.
    plan.aiChatAcceptances.push({
        id: ritmId('ai-chat-consent'),
        workspaceId,
        userId: ownerId,
        userEmail: account('owner').email,
        userName: demoAccountName(account('owner')),
        warningVersion: AI_CHAT_DATA_WARNING.version,
        acceptedAt: at(ago(7), '20:55'),
    })
    const atRisk = (['lapsed', 'declining'] as const).flatMap((reason) => {
        const p = members.find((x) => x.archetype === reason && x.kind === 'adult' && x !== called && lastVisit.has(x.id))
        return p ? [{ p, reason, last: lastVisit.get(p.id)! }] : []
    })
    const ref = (userId: string) => pseudonymFor(input.pseudonymSecret, workspaceId, userId, 'member')
    const reasonLabel = {
        lapsed: 'Абонемент закончился и не продлён',
        declining: 'Стал ходить заметно реже',
    } as const
    const advice = {
        lapsed: 'предложите продлить абонемент, пока привычка не пропала',
        declining: `узнайте, удобно ли расписание, — возможно, подойдёт другая группа или «Растяжка» по записи`,
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
            groups: p.groups.map((g) => ({ id: groupId(g), name: groupDef(g).name })),
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
                `, группа [group:${groupId(p.groups[0])}]: ${advice[reason]}.`,
        ),
        '',
        'Начните с первого: чем дольше пауза, тем труднее вернуться. После звонка отметьте его в «Кому позвонить» — список обновится.',
    ].join('\n')
    const askedAt = at(ago(1), '21:05')
    plan.aiChatConversations.push({
        id: ritmId('ai-chat:call-today'),
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
        id: ritmId('ai-chat-usage:call-today'),
        workspaceId,
        userId: ownerId,
        conversationId: ritmId('ai-chat:call-today'),
        model: 'demo',
        toolCalls: 1,
        createdAt: askedAt,
    })

    return plan
}
