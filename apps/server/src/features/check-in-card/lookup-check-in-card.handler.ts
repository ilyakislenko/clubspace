import { Feature, IFeatureHandler } from '@shelfjs/features'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { displayName } from '../attendance/schemas'
import { loadSessionForWrite } from '../attendance/session-access'
import { verifyCheckInCard } from './check-in-card-utils'
import {
    LookupCheckInCardFeature,
    LookupCheckInCardFeatureResponse,
} from './lookup-check-in-card.feature'

// The coach's door scan: who is this card, in this club, for this session?
// Whoever may mark the session may scan it (the same set as tapping a name);
// marking itself stays the records endpoint, so deduction, bookings and undo
// live in one place. Writes nothing.
@Feature(LookupCheckInCardFeature)
export class LookupCheckInCardHandler
    implements
        IFeatureHandler<LookupCheckInCardFeature, LookupCheckInCardFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: LookupCheckInCardFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const session = await loadSessionForWrite(
            this.prisma,
            this.rbac,
            ctx,
            f.workspaceId,
            f.sessionId,
        )

        const userId = verifyCheckInCard(f.payload.card, environment.encryptionKey)
        if (!userId) {
            throw new BadRequestError({
                message: 'Это не карта участника ClubSpace',
            })
        }

        // The owner is marked with no member row. Someone of another club
        // gets the same answer as an unknown id: no name leaks across clubs.
        const isOwner = ctx.workspaceOwnerId === userId
        const [membership, user] = await Promise.all([
            this.prisma.workspaceMember.findFirst({
                where: { workspaceId: f.workspaceId, userId },
                select: { status: true },
            }),
            this.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    firstname: true,
                    lastname: true,
                    email: true,
                    profilePhotoUrl: true,
                },
            }),
        ])
        if (!user || (!membership && !isOwner)) {
            throw new NotFoundError({ message: 'Этого человека нет в клубе' })
        }
        const name = displayName(user)
        // Mark-records refuses them too; say it before the coach taps.
        if (membership && membership.status !== 'ACTIVE' && !isOwner) {
            throw new BadRequestError({
                message: `${name} не активен в клубе — отметить нельзя`,
            })
        }

        const [record, groupMember] = await Promise.all([
            this.prisma.attendanceRecord.findUnique({
                where: { sessionId_userId: { sessionId: session.id, userId } },
                select: { id: true },
            }),
            session.groupId
                ? this.prisma.groupMember.findFirst({
                      where: { groupId: session.groupId, userId },
                      select: { userId: true },
                  })
                : null,
        ])

        return {
            userId,
            name,
            photoUrl: user.profilePhotoUrl,
            // A child profile has no login (and no e-mail).
            isDependent: user.email === null,
            inGroup: session.groupId ? groupMember !== null : null,
            alreadyMarked: record !== null,
        }
    }
}
