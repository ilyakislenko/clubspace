// «Реестр поясов» of an organization (design
// docs/design/2026-11-26-federation-hub-mvp.md §3.1): belts confirmed by its
// member clubs, computed live on every read. Three gates, all required:
//   - the club: link ACTIVE with `shareRegistry` on;
//   - the ladder: a copy of one of THIS org's standards (`RankLadder.templateId`
//     ∈ the org's templates) — a club's other ladders (another discipline, its
//     own scheme) never reach the federation;
//   - the person: a live ORGANIZATION_SHARING consent for this org (own, or a
//     guardian's for a child — consent.ts), and still an active member of the
//     club that awarded the belt.
// A row carries name + belt + club + date only. No user id, contact, birth
// date, photo or awarding coach ever leaves here: the person is addressed by
// `personKey`, an HMAC of (org, user) — stable within the org, unrelated
// across orgs, not reversible without the server secret.
import { createHmac } from 'crypto'

import { wallClockToUtc, localDateInTz } from '../../features/attendance/attendance-utils'
import { likePattern } from '../../features/search-videos/search-videos-utils'
import { Prisma, type PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { fullNameWithoutEmail } from '../../shared/utils/person-name'
import { allConsentedPersonIds, consentedPersonIds } from './consent'

type RegistryClient = Pick<
    PrismaService,
    'organizationClub' | 'consentRecord' | 'guardianship' | '$queryRaw'
>

export const PERSON_KEY_RE = /^p_[0-9a-f]{20}$/

export const personKeyFor = (
    secret: string,
    organizationId: string,
    userId: string,
): string =>
    'p_' +
    createHmac('sha256', secret)
        .update(`org-registry-person:${organizationId}:${userId}`)
        .digest('hex')
        .slice(0, 20)

export type RegistryRow = {
    personKey: string
    personName: string
    levelName: string
    levelColor: string | null
    stripes: number
    ladderName: string
    clubId: string
    clubName: string
    // The club-local date of the promotion.
    awardedAt: string
    // The org template level the club's level was copied from, when the club
    // adopted this org's standard.
    templateLevelName: string | null
}

type RegistryClub = { workspaceId: string; name: string; timezone: string }

// Clubs whose belts the org may see.
export const registryClubs = async (
    prisma: Pick<PrismaService, 'organizationClub'>,
    organizationId: string,
): Promise<RegistryClub[]> => {
    const links = await prisma.organizationClub.findMany({
        where: { organizationId, status: 'ACTIVE', shareRegistry: true },
        select: {
            workspaceId: true,
            workspace: { select: { name: true, timezone: true } },
        },
    })
    return links.map((l) => ({
        workspaceId: l.workspaceId,
        name: l.workspace.name,
        timezone: l.workspace.timezone,
    }))
}

type RawRow = {
    userId: string
    ladderId: string
    workspaceId: string
    stripes: number
    awardedAt: Date
    firstname: string | null
    lastname: string | null
    levelName: string
    levelColor: string | null
    ladderName: string
    templateLevelName: string | null
    total: number
}

type Scope = {
    organizationId: string
    clubIds: string[]
    personIds: string[]
}

// Promotions of people in `personIds` awarded by `clubIds` on ladders copied
// from this org's standards, to people still active members of that club.
// `latest` keeps one per (person, ladder).
const promotionsSql = (
    s: Scope,
    o: {
        latest: boolean
        where: Prisma.Sql[]
        orderBy: Prisma.Sql
        limit?: { take: number; skip: number }
    },
): Prisma.Sql => Prisma.sql`
    WITH promo AS (
        SELECT ${o.latest ? Prisma.sql`DISTINCT ON (p."userId", p."ladderId")` : Prisma.empty}
               p."userId", p."ladderId", p."levelId", p.stripes, p."awardedAt", p."workspaceId", p.id
        FROM "RankPromotion" p
        WHERE p."workspaceId" = ANY(${s.clubIds}::uuid[])
          AND p."userId" = ANY(${s.personIds}::uuid[])
          AND EXISTS (
              SELECT 1 FROM "RankLadder" l
              JOIN "OrganizationLadderTemplate" lt ON lt.id = l."templateId"
              WHERE l.id = p."ladderId" AND lt."organizationId" = ${s.organizationId}::uuid
          )
        ${o.latest ? Prisma.sql`ORDER BY p."userId", p."ladderId", p."awardedAt" DESC, p.id DESC` : Prisma.empty}
    )
    SELECT pr."userId", pr."ladderId", pr."workspaceId", pr.stripes, pr."awardedAt",
           u.firstname, u.lastname,
           lv.name AS "levelName", lv.color AS "levelColor",
           rl.name AS "ladderName", tl.name AS "templateLevelName",
           count(*) OVER ()::int AS total
    FROM promo pr
    JOIN "User" u ON u.id = pr."userId"
    JOIN "RankLevel" lv ON lv.id = pr."levelId"
    JOIN "RankLadder" rl ON rl.id = pr."ladderId"
    LEFT JOIN "OrganizationLadderTemplateLevel" tl ON tl.id = lv."templateLevelId"
        AND EXISTS (
            SELECT 1 FROM "OrganizationLadderTemplate" t
            WHERE t.id = tl."templateId" AND t."organizationId" = ${s.organizationId}::uuid
        )
    WHERE EXISTS (
        SELECT 1 FROM "WorkspaceMember" m
        WHERE m."userId" = pr."userId" AND m."workspaceId" = pr."workspaceId"
          AND m.status = 'ACTIVE'
    )
    ${o.where.length > 0 ? Prisma.sql`AND ${Prisma.join(o.where, ' AND ')}` : Prisma.empty}
    ORDER BY ${o.orderBy}
    ${o.limit ? Prisma.sql`LIMIT ${o.limit.take} OFFSET ${o.limit.skip}` : Prisma.empty}
`

const toRow = (
    secret: string,
    organizationId: string,
    clubs: Map<string, RegistryClub>,
    r: RawRow,
): RegistryRow => {
    const club = clubs.get(r.workspaceId)!
    return {
        personKey: personKeyFor(secret, organizationId, r.userId),
        personName: fullNameWithoutEmail(r),
        levelName: r.levelName,
        levelColor: r.levelColor,
        stripes: r.stripes,
        ladderName: r.ladderName,
        clubId: club.workspaceId,
        clubName: club.name,
        awardedAt: localDateInTz(r.awardedAt, club.timezone),
        templateLevelName: r.templateLevelName,
    }
}

const BY_NAME = Prisma.sql`u.lastname ASC NULLS LAST, u.firstname ASC NULLS LAST, pr."userId", rl.name`

export type RegistryQuery = {
    q?: string
    clubId?: string
    templateLevelId?: string
    // Org-local dates, inclusive.
    awardedFrom?: string
    awardedTo?: string
    curPage: number
    perPage: number
}

// The registry list: the latest promotion per person and ladder.
export const loadRegistry = async (
    prisma: RegistryClient,
    p: {
        organizationId: string
        timezone: string
        secret: string
        query: RegistryQuery
    },
): Promise<{ data: RegistryRow[]; total: number }> => {
    const clubs = await registryClubs(prisma, p.organizationId)
    const clubIds = clubs
        .map((c) => c.workspaceId)
        .filter((id) => !p.query.clubId || id === p.query.clubId)
    if (clubIds.length === 0) return { data: [], total: 0 }
    const personIds = [...(await allConsentedPersonIds(prisma, p.organizationId))]
    if (personIds.length === 0) return { data: [], total: 0 }

    const where: Prisma.Sql[] = []
    const q = p.query.q?.trim()
    if (q) {
        const pattern = likePattern(q)
        where.push(Prisma.sql`(
            concat_ws(' ', u.firstname, u.lastname) ILIKE ${pattern} ESCAPE '\\'
            OR concat_ws(' ', u.lastname, u.firstname) ILIKE ${pattern} ESCAPE '\\'
        )`)
    }
    if (p.query.templateLevelId) {
        where.push(Prisma.sql`lv."templateLevelId" = ${p.query.templateLevelId}::uuid`)
    }
    if (p.query.awardedFrom) {
        const from = wallClockToUtc(`${p.query.awardedFrom}T00:00`, p.timezone)
        where.push(Prisma.sql`pr."awardedAt" >= ${from}`)
    }
    if (p.query.awardedTo) {
        const [y, m, d] = p.query.awardedTo.split('-').map(Number)
        const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
        const to = wallClockToUtc(`${next}T00:00`, p.timezone)
        where.push(Prisma.sql`pr."awardedAt" < ${to}`)
    }

    const rows = await prisma.$queryRaw<RawRow[]>(
        promotionsSql(
            { organizationId: p.organizationId, clubIds, personIds },
            {
                latest: true,
                where,
                orderBy: BY_NAME,
                limit: {
                    take: p.query.perPage,
                    skip: (p.query.curPage - 1) * p.query.perPage,
                },
            },
        ),
    )
    const byId = new Map(clubs.map((c) => [c.workspaceId, c]))
    return {
        data: rows.map((r) => toRow(p.secret, p.organizationId, byId, r)),
        total: rows[0]?.total ?? 0,
    }
}

// One person's full history in the registry (the row-tap panel), newest
// first. Unknown key, withdrawn consent or no visible belt → 404, the same
// answer for each, so a key reveals nothing once the person is gone.
export const loadRegistryPerson = async (
    prisma: RegistryClient,
    p: { organizationId: string; secret: string; personKey: string },
): Promise<{ personKey: string; personName: string; history: RegistryRow[] }> => {
    const notFound = new NotFoundError({ message: 'Человек не найден в реестре' })
    if (!PERSON_KEY_RE.test(p.personKey)) throw notFound
    const clubs = await registryClubs(prisma, p.organizationId)
    if (clubs.length === 0) throw notFound
    const consented = await allConsentedPersonIds(prisma, p.organizationId)
    const userId = [...consented].find(
        (id) => personKeyFor(p.secret, p.organizationId, id) === p.personKey,
    )
    if (!userId) throw notFound
    const rows = await prisma.$queryRaw<RawRow[]>(
        promotionsSql(
            {
                organizationId: p.organizationId,
                clubIds: clubs.map((c) => c.workspaceId),
                personIds: [userId],
            },
            {
                latest: false,
                where: [],
                orderBy: Prisma.sql`pr."awardedAt" DESC, pr.id DESC`,
            },
        ),
    )
    if (rows.length === 0) throw notFound
    const byId = new Map(clubs.map((c) => [c.workspaceId, c]))
    const history = rows.map((r) => toRow(p.secret, p.organizationId, byId, r))
    return { personKey: p.personKey, personName: history[0].personName, history }
}

// The ladders of one club on which the org's registry shows this person right
// now («в реестре» on «Мои пояса»): every gate of the list applied — the club
// ACTIVE and sharing, a ladder copied from this org's standards, the
// person's live consent and active membership. Empty = not in the registry.
export const registryLadderIdsFor = async (
    prisma: RegistryClient,
    p: { organizationId: string; workspaceId: string; userId: string },
): Promise<string[]> => {
    const clubs = (await registryClubs(prisma, p.organizationId)).filter(
        (c) => c.workspaceId === p.workspaceId,
    )
    if (clubs.length === 0) return []
    const consented = await consentedPersonIds(prisma, p.organizationId, [p.userId])
    if (!consented.has(p.userId)) return []
    const rows = await prisma.$queryRaw<RawRow[]>(
        promotionsSql(
            { organizationId: p.organizationId, clubIds: [p.workspaceId], personIds: [p.userId] },
            { latest: true, where: [], orderBy: Prisma.sql`rl.name ASC` },
        ),
    )
    return rows.map((r) => r.ladderId)
}

export type RegistryBelt = Pick<
    RegistryRow,
    'levelName' | 'levelColor' | 'stripes' | 'ladderName'
>

// The newest visible belt of each of `userIds` (event registrations show it
// only for people the registry shows). Absent from the map = not visible.
export const registryBeltsFor = async (
    prisma: RegistryClient,
    organizationId: string,
    userIds: string[],
): Promise<Map<string, RegistryBelt>> => {
    const result = new Map<string, RegistryBelt>()
    if (userIds.length === 0) return result
    const clubs = await registryClubs(prisma, organizationId)
    if (clubs.length === 0) return result
    const personIds = [...(await consentedPersonIds(prisma, organizationId, userIds))]
    if (personIds.length === 0) return result
    const rows = await prisma.$queryRaw<RawRow[]>(
        promotionsSql(
            { organizationId, clubIds: clubs.map((c) => c.workspaceId), personIds },
            {
                latest: true,
                where: [],
                orderBy: Prisma.sql`pr."awardedAt" DESC, pr.id DESC`,
            },
        ),
    )
    for (const r of rows) {
        if (result.has(r.userId)) continue
        result.set(r.userId, {
            levelName: r.levelName,
            levelColor: r.levelColor,
            stripes: r.stripes,
            ladderName: r.ladderName,
        })
    }
    return result
}
