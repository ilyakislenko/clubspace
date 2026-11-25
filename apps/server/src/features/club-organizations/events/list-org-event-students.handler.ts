import { Feature, IFeatureHandler } from '@shelfjs/features'

import { consentedPersonIds } from '../../../domains/organizations/consent'
import { PrismaService } from '../../../infrastructure/prisma'
import { fullNameWithoutEmail } from '../../../shared/utils/person-name'
import { RbacService, ownGroupsWhere } from '../../../shared/services/rbac.service'
import { loadVisibleOrgEvent } from './club-org-events'
import {
    ListOrgEventStudentsFeature,
    ListOrgEventStudentsFeatureResponse,
} from './list-org-event-students.feature'

// «Записать учеников»: the students a coach may register — their own
// groups' (admin scope: every group of the club), active members only, with
// who consented to the federation and who is already booked.
@Feature(ListOrgEventStudentsFeature)
export class ListOrgEventStudentsHandler
    implements
        IFeatureHandler<ListOrgEventStudentsFeature, ListOrgEventStudentsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListOrgEventStudentsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const event = await loadVisibleOrgEvent(this.prisma, {
            workspaceId: f.workspaceId,
            eventId: f.eventId,
            staff: true,
            now: new Date(),
        })
        const rows = await this.prisma.groupMember.findMany({
            where: {
                group: {
                    workspaceId: f.workspaceId,
                    ...(this.rbac.canWriteAllGroups(ctx) ? {} : ownGroupsWhere(f.invokerUserId)),
                },
                user: {
                    workspaceMemberships: {
                        some: { workspaceId: f.workspaceId, status: 'ACTIVE' },
                    },
                },
            },
            distinct: ['userId'],
            select: { user: { select: { id: true, firstname: true, lastname: true } } },
        })
        const ids = rows.map((r) => r.user.id)
        const [consented, regs] = await Promise.all([
            consentedPersonIds(this.prisma, event.organizationId, ids),
            this.prisma.organizationEventRegistration.findMany({
                where: { eventId: event.id, userId: { in: ids } },
                select: {
                    id: true,
                    userId: true,
                    status: true,
                    workspaceId: true,
                    bookedById: true,
                },
            }),
        ])
        const regByUser = new Map(regs.map((r) => [r.userId, r]))
        const data = rows
            .map(({ user }) => {
                const reg = regByUser.get(user.id)
                return {
                    userId: user.id,
                    name: fullNameWithoutEmail(user),
                    consented: consented.has(user.id),
                    registration: reg
                        ? {
                              id: reg.id,
                              status: reg.status,
                              canCancel:
                                  reg.status === 'BOOKED' &&
                                  (reg.userId === f.invokerUserId ||
                                      (reg.workspaceId === f.workspaceId &&
                                          reg.bookedById === f.invokerUserId)),
                          }
                        : null,
                }
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        return { data }
    }
}
