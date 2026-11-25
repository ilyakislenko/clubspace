import { boughtSubscriptionWhere } from '../../domains/leads/lead-rules'
import type { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    LEAD_NOT_FOUND,
    type LeadOutput,
    type LeadRow,
    leadSelect,
    personName,
    serializeLead,
} from './schemas'

// Every leads route is the roster tier — strangers' phones (§12): each
// handler calls assertSportLead(rbac, leadCaller(f), LEAD_SPORT_LEAD_ONLY).
export const LEAD_SPORT_LEAD_ONLY =
    'Пробные заявки ведут владелец, администраторы и главный тренер'

export const leadCaller = (f: {
    invokerUserId: string
    workspaceId: string
    roleName: string | null
    isSuperAdmin: boolean
}) => ({
    userId: f.invokerUserId,
    workspaceId: f.workspaceId,
    roleName: f.roleName,
    isSuperAdmin: f.isSuperAdmin,
})

export type LeadClub = { id: string; name: string; timezone: string; ownerId: string }

export const loadLeadClub = async (
    prisma: Pick<PrismaService, 'workspace'>,
    workspaceId: string,
): Promise<LeadClub> => {
    const club = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true, timezone: true, ownerId: true },
    })
    if (!club) throw new NotFoundError({ message: 'Клуб не найден' })
    return club
}

export const findLeadOr404 = async (
    prisma: Pick<PrismaService, 'lead'>,
    workspaceId: string,
    leadId: string,
): Promise<LeadRow> => {
    const row = await prisma.lead.findFirst({
        where: { id: leadId, workspaceId },
        select: leadSelect,
    })
    if (!row) throw new NotFoundError({ message: LEAD_NOT_FOUND })
    return row
}

// Serializes rows with what they need from elsewhere: whether each linked
// member bought (one query for the page) and the names of the staff who
// attested a manual consent.
export const serializeLeads = async (
    prisma: Pick<PrismaService, 'subscription' | 'user'>,
    p: { workspaceId: string; timezone: string; rows: LeadRow[]; now: Date },
): Promise<LeadOutput[]> => {
    const linked = [
        ...new Set(p.rows.flatMap((r) => (r.convertedUserId ? [r.convertedUserId] : []))),
    ]
    const staffIds = [
        ...new Set(
            p.rows.flatMap((r) => (r.consentRecordedById ? [r.consentRecordedById] : [])),
        ),
    ]
    const [bought, staff] = await Promise.all([
        linked.length
            ? prisma.subscription.findMany({
                  where: { ...boughtSubscriptionWhere(p.workspaceId), userId: { in: linked } },
                  select: { userId: true },
                  distinct: ['userId'],
              })
            : [],
        staffIds.length
            ? prisma.user.findMany({
                  where: { id: { in: staffIds } },
                  select: { id: true, firstname: true, lastname: true, email: true },
              })
            : [],
    ])
    const boughtIds = new Set(bought.map((b) => b.userId))
    const staffNames = new Map(
        staff.map((u) => [u.id, personName(u) ?? u.email ?? 'Сотрудник']),
    )
    return p.rows.map((row) =>
        serializeLead(row, {
            now: p.now,
            timezone: p.timezone,
            bought: row.convertedUserId !== null && boughtIds.has(row.convertedUserId),
            staffNames,
        }),
    )
}

export const serializeOneLead = async (
    prisma: Pick<PrismaService, 'subscription' | 'user'>,
    p: { workspaceId: string; timezone: string; row: LeadRow; now: Date },
): Promise<LeadOutput> =>
    (await serializeLeads(prisma, { ...p, rows: [p.row] }))[0]

// The club's active direction with its name denormalised; null for an id that
// is not one (the public form ignores it, staff routes refuse it).
export const findLeadDirection = async (
    prisma: Pick<PrismaService, 'direction'>,
    workspaceId: string,
    directionId: string | null | undefined,
): Promise<{ directionId: string; directionName: string } | null> => {
    if (!directionId) return null
    const d = await prisma.direction.findFirst({
        where: { id: directionId, workspaceId, isActive: true },
        select: { id: true, name: true },
    })
    return d ? { directionId: d.id, directionName: d.name } : null
}
