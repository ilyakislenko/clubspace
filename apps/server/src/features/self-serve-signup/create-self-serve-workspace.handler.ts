import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { defaultFeatureColumnsFor } from '../../domains/workspace/feature-flags'
import { resolveWorkspaceKey } from '../../domains/workspace/workspace-key.store'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import {
    CreateSelfServeWorkspaceFeature,
    CreateSelfServeWorkspaceFeatureResponse,
} from './create-self-serve-workspace.feature'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

const TRIAL_USED_MESSAGE =
    'С этого аккаунта уже создан клуб с пробным периодом. Чтобы открыть ещё один клуб, напишите нам — подключим его вручную.'

// «Создать клуб» from the admin's /sign-up page: the signed-in person becomes
// the owner of a new club on a trial of the trial plan. One trial per account
// (WorkspaceBilling.trialOwnerId is unique), rate-limited on the route, and
// audited like a club created from the platform console.
@Feature(CreateSelfServeWorkspaceFeature)
export class CreateSelfServeWorkspaceHandler
    implements
        IFeatureHandler<
            CreateSelfServeWorkspaceFeature,
            CreateSelfServeWorkspaceFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute(f: CreateSelfServeWorkspaceFeature) {
        if (!environment.billing.selfServeSignupEnabled) {
            throw new ForbiddenError({
                message:
                    'Самостоятельное создание клубов отключено. Напишите нам — подключим клуб вручную.',
            })
        }

        if (await this.billing.hasUsedTrial(f.invokerUserId)) {
            throw new ConflictError({ message: TRIAL_USED_MESSAGE })
        }

        const { name, type, timezone } = f.payload
        const city = f.payload.city?.trim() || null

        // Same reason as on the platform console: without the role the owner
        // could not administer the club they just made.
        const adminRole = await this.prisma.role.findUnique({
            where: { name: 'admin' },
            select: { id: true },
        })
        if (!adminRole) {
            throw new BadRequestError({
                message:
                    'Роль «admin» отсутствует — платформа не до конца инициализирована',
            })
        }

        // Nobody can type a key in the wizard, so a name with no usable
        // characters gets a generic base instead of an error.
        const key = await resolveWorkspaceKey(this.prisma, name, undefined, 'club')

        let created: { workspaceId: string; trialEndsAt: Date | null; planName: string }
        try {
            created = await this.prisma.$transaction(async (tx) => {
                const workspace = await tx.workspace.create({
                    data: {
                        key,
                        name,
                        type,
                        timezone,
                        city,
                        ownerId: f.invokerUserId,
                        isActive: true,
                        ...defaultFeatureColumnsFor(type),
                    },
                    select: { id: true },
                })
                // get-my-workspaces (how both apps find clubs) reads
                // memberships, so the owner needs a row to see their club.
                await tx.workspaceMember.create({
                    data: {
                        userId: f.invokerUserId,
                        workspaceId: workspace.id,
                        roleId: adminRole.id,
                        status: 'ACTIVE',
                    },
                })
                const billing = await this.billing.startTrial(tx, {
                    workspaceId: workspace.id,
                    ownerId: f.invokerUserId,
                })
                return {
                    workspaceId: workspace.id,
                    trialEndsAt: billing.trialEndsAt,
                    planName: billing.plan.name,
                }
            })
        } catch (e) {
            if (!isP2002(e)) throw e
            // Either a double submit claimed the trial first, or another club
            // took the derived key between the lookup and the insert.
            if (await this.billing.hasUsedTrial(f.invokerUserId)) {
                throw new ConflictError({ message: TRIAL_USED_MESSAGE })
            }
            throw new ConflictError({
                message: 'Не получилось создать клуб — попробуйте ещё раз',
            })
        }

        await this.audit.record({
            action: 'workspace.create',
            targetType: 'workspace',
            targetId: created.workspaceId,
            workspaceId: created.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                selfServe: true,
                key,
                name,
                type,
                timezone,
                city,
                trialEndsAt: created.trialEndsAt?.toISOString() ?? null,
            },
        })

        return {
            workspaceId: created.workspaceId,
            key,
            name,
            status: 'TRIAL' as const,
            planName: created.planName,
            trialEndsAt: created.trialEndsAt?.toISOString() ?? null,
        }
    }
}
