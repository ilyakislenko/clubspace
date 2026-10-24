import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetLadderRosterFeature,
    GetLadderRosterFeatureResponse,
} from './get-ladder-roster.feature'
import { serializeLadderRosterEntry, type LadderRosterEntry } from './schemas'

const USER_SELECT = {
    id: true,
    firstname: true,
    lastname: true,
    email: true,
} as const

const sortName = (e: LadderRosterEntry): string =>
    [e.lastname, e.firstname].filter(Boolean).join(' ') || e.email

// Everyone a coach can rank — active members plus the owner, who has no member
// row — with their current level on this ladder, so the admin can rank the
// whole club from one screen instead of opening every profile.
@Feature(GetLadderRosterFeature)
export class GetLadderRosterHandler
    implements
        IFeatureHandler<GetLadderRosterFeature, GetLadderRosterFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetLadderRosterFeature) {
        const ctx = await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })

        const ladder = await this.prisma.rankLadder.findFirst({
            where: { id: f.ladderId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!ladder) throw new NotFoundError({ message: 'Лестница не найдена' })

        const [members, owner] = await Promise.all([
            this.prisma.workspaceMember.findMany({
                where: {
                    workspaceId: f.workspaceId,
                    status: 'ACTIVE',
                    user: { deletedAt: null },
                },
                select: { user: { select: USER_SELECT } },
            }),
            this.prisma.user.findUnique({
                where: { id: ctx.workspaceOwnerId },
                select: USER_SELECT,
            }),
        ])
        const users = new Map(members.map((m) => [m.user.id, m.user]))
        if (owner) users.set(owner.id, owner)

        // Newest promotion per member on this ladder = their current level.
        // Scoped to today's roster: ex-members' history never needs loading.
        const latest = await this.prisma.rankPromotion.findMany({
            where: {
                workspaceId: f.workspaceId,
                ladderId: f.ladderId,
                userId: { in: [...users.keys()] },
            },
            distinct: ['userId'],
            orderBy: { awardedAt: 'desc' },
            select: {
                userId: true,
                levelId: true,
                stripes: true,
                awardedAt: true,
                level: { select: { name: true, color: true } },
            },
        })
        const latestByUser = new Map(latest.map((p) => [p.userId, p]))

        const data = [...users.values()]
            .map((user) =>
                serializeLadderRosterEntry(
                    user,
                    user.id === ctx.workspaceOwnerId,
                    latestByUser.get(user.id) ?? null,
                ),
            )
            .sort(
                (a, b) =>
                    Number(b.isOwner) - Number(a.isOwner) ||
                    sortName(a).localeCompare(sortName(b), 'ru'),
            )
        return { data }
    }
}
