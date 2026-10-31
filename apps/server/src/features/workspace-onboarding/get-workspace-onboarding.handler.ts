import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetWorkspaceOnboardingFeature,
    GetWorkspaceOnboardingFeatureResponse,
    ONBOARDING_STEP_KEYS,
} from './get-workspace-onboarding.feature'

@Feature(GetWorkspaceOnboardingFeature)
export class GetWorkspaceOnboardingHandler
    implements
        IFeatureHandler<
            GetWorkspaceOnboardingFeature,
            GetWorkspaceOnboardingFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetWorkspaceOnboardingFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Чек-лист запуска видит только администратор клуба',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { ownerId: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        // Existence checks, not counts: findFirst stops at the first row.
        const [gym, group, slot, member, video] = await Promise.all([
            this.prisma.gym.findFirst({
                where: { workspaceId: f.workspaceId },
                select: { id: true },
            }),
            this.prisma.group.findFirst({
                where: { workspaceId: f.workspaceId },
                select: { id: true },
            }),
            this.prisma.groupScheduleSlot.findFirst({
                where: { group: { workspaceId: f.workspaceId } },
                select: { id: true },
            }),
            // Anyone besides the owner, invited or joined: the invitation (or
            // the printed QR) has done its job once someone shows up.
            this.prisma.workspaceMember.findFirst({
                where: {
                    workspaceId: f.workspaceId,
                    userId: { not: workspace.ownerId },
                    status: { in: ['ACTIVE', 'INVITED'] },
                },
                select: { id: true },
            }),
            this.prisma.video.findFirst({
                where: {
                    workspaceId: f.workspaceId,
                    status: { not: 'failed' },
                },
                select: { id: true },
            }),
        ])

        const done: Record<(typeof ONBOARDING_STEP_KEYS)[number], boolean> = {
            gym: gym !== null,
            group: group !== null,
            schedule: slot !== null,
            members: member !== null,
            video: video !== null,
        }
        const steps = ONBOARDING_STEP_KEYS.map((key) => ({
            key,
            done: done[key],
        }))

        return {
            steps,
            doneCount: steps.filter((s) => s.done).length,
            total: steps.length,
        }
    }
}
