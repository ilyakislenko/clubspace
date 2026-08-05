import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateGroupFeature,
    CreateGroupFeatureResponse,
} from './create-group.feature'

const COACH_CAPABLE_ROLES = ['admin', 'head_coach', 'coach']

@Feature(CreateGroupFeature)
export class CreateGroupHandler
    implements IFeatureHandler<CreateGroupFeature, CreateGroupFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: CreateGroupFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        // Coaches can only spawn groups they themselves lead. Admin scope
        // can pin any club member as coach.
        this.rbac.assertCanCreateGroupAs(ctx, payload.coachId)

        // Validate that gym + coach + every member belong to this workspace.
        // Without this a malicious request could attach a coach from another
        // club, leaking who they are when the group is rendered.
        const [gym, coachMembership] = await Promise.all([
            this.prisma.gym.findFirst({
                where: { id: payload.gymId, workspaceId },
                select: { id: true },
            }),
            this.prisma.workspaceMember.findFirst({
                where: { userId: payload.coachId, workspaceId },
                include: { role: { select: { name: true } } },
            }),
        ])

        if (!gym) throw new NotFoundError({ message: 'Зал не найден' })
        if (!coachMembership) {
            throw new BadRequestError({
                message: 'Тренер должен быть участником клуба',
            })
        }

        // Workspace owner is implicitly coach-capable. Otherwise the role
        // must be coach/head_coach/admin — pinning a 'user' as coach
        // creates a split-brain (group says X is coach, RoleGuard says
        // they have no admin access).
        const isOwner = ctx.workspaceOwnerId === payload.coachId
        if (
            !isOwner &&
            !COACH_CAPABLE_ROLES.includes(coachMembership.role.name)
        ) {
            throw new BadRequestError({
                message:
                    'У выбранного участника нет тренерской роли — сначала повысьте его',
            })
        }

        const memberIds = payload.memberIds ?? []
        // Coach can't double as a student in their own group — both
        // listings would point to the same user with conflicting roles.
        if (memberIds.includes(payload.coachId)) {
            throw new BadRequestError({
                message:
                    'Тренера нельзя добавить учеником в его же группу',
            })
        }
        if (memberIds.length > 0) {
            const validMembers = await this.prisma.workspaceMember.findMany({
                where: { workspaceId, userId: { in: memberIds } },
                select: { userId: true },
            })
            const validIds = new Set(validMembers.map((m) => m.userId))
            const invalid = memberIds.filter((id) => !validIds.has(id))
            if (invalid.length > 0) {
                throw new BadRequestError({
                    message: `Некоторые ученики не состоят в клубе: ${invalid.join(', ')}`,
                })
            }
        }

        // Materialise the primary coach into the GroupCoach junction at
        // creation time so multi-coach reads always see them. Wrapping
        // the two writes in a single transaction prevents a half-state
        // where the group exists but the junction row is missing — that
        // would silently break assertCanWriteGroup for the lead coach.
        const group = await this.prisma.$transaction(async (tx) => {
            const created = await tx.group.create({
                data: {
                    workspaceId,
                    name: payload.name,
                    gymId: payload.gymId,
                    coachId: payload.coachId,
                    members: {
                        create: memberIds.map((userId) => ({ userId })),
                    },
                },
            })
            await tx.groupCoach.create({
                data: {
                    groupId: created.id,
                    userId: payload.coachId,
                    role: 'primary',
                },
            })
            return created
        })

        await this.audit.record({
            action: 'group.create',
            targetType: 'group',
            targetId: group.id,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                name: group.name,
                gymId: group.gymId,
                coachId: group.coachId,
                memberCount: memberIds.length,
            },
        })

        return {
            id: group.id,
            name: group.name,
            gymId: group.gymId,
            coachId: group.coachId,
        }
    }
}
