import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    isWorkspaceEntitled,
    moduleEntitlementSelect,
} from '../../domains/billing/module-entitlement'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
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
        await assertClubAdmin(
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
            select: {
                ownerId: true,
                videosEnabled: true,
                scheduleEnabled: true,
                subscriptionEnabled: true,
                ...moduleEntitlementSelect('ONLINE_PAYMENTS'),
            },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        // Existence checks, not counts: findFirst stops at the first row.
        const [gym, group, slot, member, video, plan, payments] = await Promise.all([
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
            // A tariff the club can sell or assign: abonements need one.
            this.prisma.plan.findFirst({
                where: { workspaceId: f.workspaceId, isActive: true },
                select: { id: true },
            }),
            // Online payment connected (YooKassa / Stripe keys saved).
            this.prisma.workspacePaymentSettings.findUnique({
                where: { workspaceId: f.workspaceId },
                select: { workspaceId: true },
            }),
        ])

        const done: Record<(typeof ONBOARDING_STEP_KEYS)[number], boolean> = {
            gym: gym !== null,
            group: group !== null,
            schedule: slot !== null,
            members: member !== null,
            video: video !== null,
            plans: plan !== null,
            payments: payments !== null,
        }
        // A club that switched a section off (a fitness or yoga club starts
        // without video) is not asked to fill it.
        const off = new Set<string>([
            ...(workspace.videosEnabled ? [] : ['video']),
            ...(workspace.scheduleEnabled ? [] : ['schedule']),
            ...(workspace.subscriptionEnabled ? [] : ['plans', 'payments']),
            // Payment keys can only be saved with the «Онлайн-оплата» module:
            // a club paying in person is not asked for them.
            ...(isWorkspaceEntitled(workspace) ? [] : ['payments']),
        ])
        const steps = ONBOARDING_STEP_KEYS.filter((key) => !off.has(key)).map((key) => ({
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
