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
import { addDaysYmd, ymdToDbDate } from '../subscriptions/freeze-dates'
import { defaultFeatureColumnsFor } from '../workspace/feature-flags'
import { type DemoAccountKey, demoAccountName } from './demo-accounts'
import {
    FEMALE_NAMES,
    MALE_NAMES,
    SURNAMES,
    femaleSurname,
    translit,
} from './demo-club.catalog'
import { type DemoClubPlan, type DemoPlanInput, type DemoRoleName, demoUuid } from './demo-club.plan'
import {
    RITM_ACCOUNTS,
    RITM_CLUB_KEY,
    RITM_CLUB_NAME,
    RITM_EMAIL_DOMAIN,
    RITM_JOIN_CODE,
    RITM_PARENT_CHILDREN,
} from './ritm-demo.accounts'

// The dance-studio demo club «Ритм» (docs/demo.md), built the way ACADEMY is
// (demo-club.plan.ts) but smaller: two halls, five directions, ~70 students
// (about a third children with their parents), abonements 4/8/12, a single and
// a free trial, three months of visits, a paid master class with places and a
// waitlist, and placeholder videos of combinations. Deterministic: the same
// club-local day always yields the same rows, ids and counts; every date is
// relative to today. Pure — demo-club.writer.ts inserts the rows. Texts that
// name a class or a teacher come from the DANCE vocabulary («занятие»,
// «педагог»), never «тренировка / тренер».

const DAY_MS = 24 * 60 * 60 * 1000
const SEED = 20_261_103
// Three months and a week of visits and sales.
export const RITM_HISTORY_DAYS = 98
const FAR_FUTURE_DAYS = 5 * 365
const ADULTS = 50
const KIDS = 22
// Children whose parent confirmed the link; the rest wait for the parent.
const CONFIRMED_PARENTS = 14

const ritmId = (name: string) => demoUuid(`ritm:${name}`)

type StaffKey = 'owner' | 'korolyova' | 'orekhova' | 'akhmetov'
type DirKey = 'hiphop' | 'heels' | 'contemp' | 'kids' | 'master'
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
    { key: 'kids', name: 'Детские группы', color: '#f59e0b', icon: '🧸' },
    { key: 'master', name: 'Мастер-классы', color: '#2563eb', icon: '⭐' },
]
// The abonements cover the regular classes; a master class is paid by ticket.
const REGULAR_DIRS: DirKey[] = ['heels', 'hiphop', 'contemp', 'kids']

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
    { key: 'korolyova', role: 'coach', account: 'coach', firstname: 'Алина', lastname: 'Королёва', description: `${cap(VOCABULARY.coach.nom)} High heels` },
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
    const addPerson = (p: Omit<Person, 'idx' | 'id' | 'subs' | 'visits' | 'email'> & { email?: string | null }) => {
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

    const archetypeAt = (r: number): Archetype =>
        r < 0.72 ? 'regular' : r < 0.84 ? 'newcomer' : r < 0.91 ? 'lapsed' : r < 0.97 ? 'declining' : 'trialOnly'
    const joinFor = (a: Archetype) =>
        a === 'newcomer' || a === 'trialOnly' ? ago(int(3, 40)) : ago(int(60, 600))
    for (let i = 0; i < ADULTS - 2; i++) {
        const female = rnd() < 0.88
        const name = freshName(female, female ? FEMALE_NAMES : MALE_NAMES)
        const archetype = archetypeAt(rnd())
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
            target: int(1, 3),
        })
    }
    for (let i = 0; i < KIDS - 2; i++) {
        const female = rnd() < 0.75
        const name = freshName(female, female ? FEMALE_NAMES : MALE_NAMES)
        const age = int(6, 13)
        const archetype = archetypeAt(rnd() * 0.95)
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
        return tariffDef(p.idx % 6 === 0 ? 'single' : 'pack4')
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
    const covering = (p: Person, dir: DirKey, instant: Date) =>
        p.subs.find(
            (s) => s.startAt <= instant && instant < s.endAt && s.remaining > 0 && s.tariff.dirs.includes(dir),
        ) ?? null
    const chance = (p: Person, ymd: string): number => {
        if (ymd < p.joinYmd || (p.stopYmd && ymd > p.stopYmd)) return 0
        if (p.archetype === 'trialOnly') return p.visits === 0 ? 0.95 : 0
        const slots = p.groups.reduce((n, k) => n + groupDef(k).slots.length, 0)
        const base = Math.min(0.95, p.target / slots)
        if (p.archetype === 'declining' && ymd >= ago(21)) return base * 0.1
        return base
    }
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
    for (let ymd = historyStart; ymd < today; ymd = addDaysYmd(ymd, 1)) {
        const weekday = dow(ymd)
        for (const g of GROUPS) {
            g.slots.forEach(([day, time], i) => {
                if (day !== weekday) return
                const startAt = at(ymd, time)
                const sessionId = ritmId(`session:${g.key}:${i}:${ymd}`)
                const before = plan.records.length
                for (const p of persons) {
                    if (!p.groups.includes(g.key) || rnd() >= chance(p, ymd)) continue
                    let sub = covering(p, g.dir, startAt)
                    if (!sub) {
                        const first = p.subs.length === 0 && (p.archetype === 'newcomer' || p.archetype === 'trialOnly')
                        sub = buy(p, first ? tariffDef('trial') : tariffFor(p), ymd, time)
                    }
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
    // The fixed people always hold a running abonement with classes left.
    for (const p of fixedPeople) {
        const live = p.subs.find((s) => s.startAt <= now && now < s.endAt && s.remaining > 0)
        if (!live) buy(p, tariffFor(p), ago(int(3, 8)), '18:00').remaining = tariffFor(p).classes - 1
    }
    // Three paid at the next visit — «Долги» has someone to show.
    persons
        .filter((p) => !fixedPeople.has(p) && p.archetype === 'regular' && p.kind === 'adult')
        .slice(0, 3)
        .forEach((p) => {
            const last = p.subs.at(-1)
            if (last && last.tariff.price > 0) last.isPaid = false
        })
    // Most regulars renew before the running abonement ends: the next one is
    // bought ahead and waits for its first class, so only part of the studio
    // shows in «К продлению» and «Доступ истекает», as in a healthy studio.
    for (const p of persons) {
        if (fixedPeople.has(p) || p.archetype !== 'regular' || p.stopYmd) continue
        const live = p.subs.find((s) => s.startAt <= now && now < s.endAt)
        if (!live || live.tariff.isFreeTrial || rnd() >= 0.8) continue
        const daysLeft = (live.endAt.getTime() - now.getTime()) / DAY_MS
        if (daysLeft > 12 && live.remaining > 1) continue
        const t = live.tariff.key === 'single' ? tariffDef('pack4') : live.tariff
        // After the last visit (a visit since would have started it).
        const drawn = ago(int(0, 3))
        const saleYmd = drawn > (lastVisit.get(p.id) ?? '') ? drawn : today
        const next = buy(p, t, saleYmd, '10:00')
        next.soldAt = new Date(Math.min(next.soldAt.getTime(), now.getTime() - 30 * 60_000))
        next.pending = true
        next.endAt = at(addDaysYmd(saleYmd, 14 + t.days), '00:00')
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
                classesTotal: s.tariff.classes,
                classesRemaining: s.remaining,
                workspaceMemberId: ritmId(`member:${p.idx}`),
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

    return plan
}
