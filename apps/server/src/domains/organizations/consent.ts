// Person-level consent to show one organization a member's name, belt, club,
// promotion dates and org event registrations (152-ФЗ; design
// docs/design/2026-11-26-federation-hub-mvp.md §1, §3.1). Evidence is a
// ConsentRecord of kind ORGANIZATION_SHARING with `organizationId`; a guardian
// gives it for a child (`dependentId`, the DEPENDENT_DATA pattern) and it
// counts only while that guardianship is confirmed. Withdrawal stamps
// `withdrawnAt` on every live record for the person, so the registry (computed
// live) drops them at once.
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { DefaultError } from '../../shared/errors/default.error'

// Bump when either text below changes; a record keeps the edition it was
// given for. .2: the guardian's wording for a child. 2026-11-27.1: tournaments
// (birth year, sex and weight at the weigh-in; names in brackets and results
// seen by the federation's clubs — docs/design/2026-11-27-tournaments.md §2.4).
export const ORG_SHARING_CONSENT_VERSION = '2026-11-27.1'

// The edition a tournament entry needs (and that shows a name in brackets).
// Older editions still cover what they said: the registry and plain
// registration.
export const TOURNAMENT_CONSENT_MIN_VERSION = '2026-11-27.1'

// `forChild`: a guardian acting for a child (X-Act-As) consents for the child
// (the record carries dependentId), so the text names the child, not the signer.
export const orgSharingConsentText = (
    organizationName: string,
    forChild = false,
): string =>
    (forChild
        ? `Я разрешаю передавать федерации «${organizationName}» имя и фамилию ` +
          'моего ребёнка, его пояс (ступень), клуб, даты присвоения поясов и его ' +
          'записи на события федерации, а для турниров федерации — год рождения, ' +
          'пол и вес ребёнка на взвешивании; его имя, клуб, категория и результаты ' +
          'видны участникам и тренерам клубов федерации. '
        : `Я разрешаю передавать федерации «${organizationName}» моё имя и фамилию, ` +
          'пояс (ступень), клуб, даты присвоения поясов и мои записи на события ' +
          'федерации, а для турниров федерации — год рождения, пол и вес на ' +
          'взвешивании; имя, клуб, категория и результаты видны участникам и ' +
          'тренерам клубов федерации. ') +
    'Федерация не получает контакты, дату рождения и фото. ' +
    'Согласие можно отозвать в приложении в любой момент — после отзыва ' +
    'федерация перестаёт видеть эти данные сразу.'

// Registering for an org event needs the athlete's consent, a tournament
// entry the current edition; the app asks first (`ORG_CONSENT_REQUIRED`). A
// coach can't consent for a student: the coach reads that the student must
// update it.
export class OrgConsentRequiredError extends DefaultError {
    constructor(message = 'Сначала разрешите федерации видеть ваше имя, пояс и клуб') {
        super({
            message,
            code: 'ORG_CONSENT_REQUIRED',
            statusCode: 409,
        })
    }
}

// `minVersion`: only records of that edition or newer count. Editions are
// date-prefixed, so a plain string comparison orders them.
export type ConsentEditionFilter = { minVersion?: string }

const atLeast = <R extends { version: string }>(records: R[], o: ConsentEditionFilter): R[] =>
    o.minVersion ? records.filter((r) => r.version >= o.minVersion!) : records

type ConsentClient = Pick<PrismaService, 'consentRecord' | 'guardianship'>

const LIVE_ORG_RECORD = (organizationId: string) =>
    ({
        organizationId,
        kind: 'ORGANIZATION_SHARING',
        withdrawnAt: null,
    }) satisfies Prisma.ConsentRecordWhereInput

// Live records for this org that may count for one of `personIds`: their own
// (no dependentId) or a guardian's for them. A guardian record still needs
// the guardianship check (resolveConsented).
const liveRecordsWhere = (
    organizationId: string,
    personIds: string[],
): Prisma.ConsentRecordWhereInput => ({
    ...LIVE_ORG_RECORD(organizationId),
    OR: [
        { userId: { in: personIds }, dependentId: null },
        { dependentId: { in: personIds } },
    ],
})

// The people the records stand for: the signer of an own record, the child
// of a guardian's record whose guardianship is confirmed (consentAt set).
const resolveConsented = async (
    prisma: ConsentClient,
    records: Array<{ userId: string; dependentId: string | null }>,
): Promise<Set<string>> => {
    const result = new Set<string>()
    const signedBy = new Map<string, Set<string>>() // dependentId → guardianIds
    for (const r of records) {
        if (r.dependentId === null) result.add(r.userId)
        else {
            const set = signedBy.get(r.dependentId) ?? new Set<string>()
            set.add(r.userId)
            signedBy.set(r.dependentId, set)
        }
    }
    const pending = [...signedBy.keys()].filter((id) => !result.has(id))
    if (pending.length > 0) {
        const confirmed = await prisma.guardianship.findMany({
            where: { dependentId: { in: pending }, consentAt: { not: null } },
            select: { guardianId: true, dependentId: true },
        })
        for (const g of confirmed) {
            if (signedBy.get(g.dependentId)?.has(g.guardianId)) {
                result.add(g.dependentId)
            }
        }
    }
    return result
}

// Which of `personIds` the org may see (at `minVersion` or newer when given).
export const consentedPersonIds = async (
    prisma: ConsentClient,
    organizationId: string,
    personIds: string[],
    o: ConsentEditionFilter = {},
): Promise<Set<string>> => {
    if (personIds.length === 0) return new Set()
    const records = await prisma.consentRecord.findMany({
        where: liveRecordsWhere(organizationId, personIds),
        select: { userId: true, dependentId: true, version: true },
    })
    return resolveConsented(prisma, atLeast(records, o))
}

// Everyone the org may see (the registry's population).
export const allConsentedPersonIds = async (
    prisma: ConsentClient,
    organizationId: string,
): Promise<Set<string>> => {
    const records = await prisma.consentRecord.findMany({
        where: LIVE_ORG_RECORD(organizationId),
        select: { userId: true, dependentId: true },
    })
    return resolveConsented(prisma, records)
}

export const hasOrgConsent = async (
    prisma: ConsentClient,
    organizationId: string,
    personId: string,
    o: ConsentEditionFilter = {},
): Promise<boolean> =>
    (await consentedPersonIds(prisma, organizationId, [personId], o)).has(personId)

// When the person's consent for this org was given (the latest live record
// that counts), null when none.
export const orgConsentGrantedAt = async (
    prisma: ConsentClient,
    organizationId: string,
    personId: string,
): Promise<Date | null> => {
    if (!(await hasOrgConsent(prisma, organizationId, personId))) return null
    const latest = await prisma.consentRecord.findFirst({
        where: liveRecordsWhere(organizationId, [personId]),
        orderBy: { acceptedAt: 'desc' },
        select: { acceptedAt: true },
    })
    return latest?.acceptedAt ?? null
}

// Column widths of ConsentRecord.ip / userAgent.
const IP_MAX = 64
const USER_AGENT_MAX = 512

// Idempotent: a person whose live consent is at the current edition gets no
// second record; an older live edition is re-granted with a new record (the
// old one stays as evidence). Acting as a child (`guardianId` set) records
// the guardian's consent for the child.
export const grantOrgConsent = async (
    prisma: ConsentClient,
    p: {
        organizationId: string
        personId: string
        guardianId: string | null
        ip: string | null
        userAgent: string | null
    },
): Promise<void> => {
    if (
        await hasOrgConsent(prisma, p.organizationId, p.personId, {
            minVersion: ORG_SHARING_CONSENT_VERSION,
        })
    ) {
        return
    }
    await prisma.consentRecord.create({
        data: {
            userId: p.guardianId ?? p.personId,
            dependentId: p.guardianId ? p.personId : null,
            organizationId: p.organizationId,
            kind: 'ORGANIZATION_SHARING',
            version: ORG_SHARING_CONSENT_VERSION,
            ip: p.ip ? p.ip.slice(0, IP_MAX) : null,
            userAgent: p.userAgent ? p.userAgent.slice(0, USER_AGENT_MAX) : null,
        },
        select: { id: true },
    })
}

// Every live record for the person in this org (their own and any guardian's)
// is stamped: withdrawal means the org stops seeing them, whoever consented.
export const withdrawOrgConsent = async (
    prisma: ConsentClient,
    p: { organizationId: string; personId: string; now: Date },
): Promise<number> => {
    const { count } = await prisma.consentRecord.updateMany({
        where: liveRecordsWhere(p.organizationId, [p.personId]),
        data: { withdrawnAt: p.now },
    })
    return count
}
