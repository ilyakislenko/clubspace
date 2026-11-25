import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    boughtUserWhere,
    needsActionWhere,
    phoneDigits,
} from '../../domains/leads/lead-rules'
import { type Prisma, PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { LEAD_SPORT_LEAD_ONLY, leadCaller, serializeLeads } from './leads-utils'
import {
    LEADS_DEFAULT_PER_PAGE,
    ListLeadsFeature,
    type ListLeadsFeatureResponse,
    type LeadView,
} from './list-leads.feature'
import { leadSelect } from './schemas'

// The where of each view. Stored-status views leave out leads that bought
// (BOUGHT wins on display); anonymised leads show only under lost and all.
export const leadViewWhere = (
    view: LeadView,
    workspaceId: string,
    now: Date,
): Prisma.LeadWhereInput => {
    const notBought: Prisma.LeadWhereInput = { NOT: boughtUserWhere(workspaceId) }
    const live = { anonymizedAt: null }
    switch (view) {
        case 'needsAction':
            return needsActionWhere(now)
        case 'new':
            return { ...live, status: 'NEW', ...notBought }
        case 'contacted':
            return { ...live, status: 'CONTACTED', ...notBought }
        case 'trialBooked':
            return { ...live, status: 'TRIAL_BOOKED', ...notBought }
        case 'came':
            return { ...live, status: 'CAME', ...notBought }
        case 'bought':
            return { ...live, ...boughtUserWhere(workspaceId) }
        case 'lost':
            return { status: 'LOST', ...notBought }
        case 'all':
            return {}
    }
}

// «+7 952…», «8 952…» and «952…» all find «+79528849420».
const searchWhere = (q: string): Prisma.LeadWhereInput => {
    const digits = phoneDigits(q)
    const phone =
        digits.length >= 3
            ? [digits, ...(digits.length === 11 && digits.startsWith('8') ? [`7${digits.slice(1)}`] : [])]
            : []
    return {
        OR: [
            { name: { contains: q, mode: 'insensitive' } },
            ...phone.map((d) => ({ phone: { contains: d } })),
        ],
    }
}

@Feature(ListLeadsFeature)
export class ListLeadsHandler
    implements IFeatureHandler<ListLeadsFeature, ListLeadsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListLeadsFeature): Promise<ListLeadsFeatureResponse> {
        await assertSportLead(this.rbac, leadCaller(f), LEAD_SPORT_LEAD_ONLY)
        const { workspaceId, now } = f
        const view = f.payload.view ?? 'needsAction'
        const perPage = f.payload.perPage ?? LEADS_DEFAULT_PER_PAGE
        const curPage = f.payload.curPage ?? 1
        const club = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: {
                timezone: true,
                trialRequestsEnabled: true,
                pdOperatorName: true,
                pdOperatorAddress: true,
            },
        })
        if (!club) throw new NotFoundError({ message: 'Клуб не найден' })
        const { timezone } = club

        const where: Prisma.LeadWhereInput = {
            AND: [
                { workspaceId },
                leadViewWhere(view, workspaceId, now),
                ...(f.payload.source ? [{ source: f.payload.source }] : []),
                ...(f.payload.q ? [searchWhere(f.payload.q)] : []),
            ],
        }
        const count = (v: LeadView) =>
            this.prisma.lead.count({
                where: { AND: [{ workspaceId }, leadViewWhere(v, workspaceId, now)] },
            })
        const [rows, total, newCount, trialOverdue, contacted, trialBooked, came, bought, lost] =
            await Promise.all([
                this.prisma.lead.findMany({
                    where,
                    select: leadSelect,
                    orderBy:
                        view === 'needsAction'
                            ? [{ statusChangedAt: 'asc' }, { id: 'asc' }]
                            : [{ statusChangedAt: 'desc' }, { id: 'asc' }],
                    skip: (curPage - 1) * perPage,
                    take: perPage,
                }),
                this.prisma.lead.count({ where }),
                count('new'),
                this.prisma.lead.count({
                    where: {
                        workspaceId,
                        anonymizedAt: null,
                        status: 'TRIAL_BOOKED',
                        trialAt: { lt: now },
                    },
                }),
                count('contacted'),
                count('trialBooked'),
                count('came'),
                count('bought'),
                count('lost'),
            ])

        return {
            data: await serializeLeads(this.prisma, { workspaceId, timezone, rows, now }),
            total,
            counts: {
                needsAction: newCount + trialOverdue,
                new: newCount,
                trialOverdue,
                contacted,
                trialBooked,
                came,
                bought,
                lost,
            },
            formEnabled: Boolean(
                club.trialRequestsEnabled && club.pdOperatorName && club.pdOperatorAddress,
            ),
            timezone,
        }
    }
}
