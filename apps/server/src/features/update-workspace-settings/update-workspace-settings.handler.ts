import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { ModuleEntitlementService } from '../../domains/billing/services/module-entitlement.service'
import { featureFlagSelect } from '../../domains/workspace/feature-flags'
import {
    activeFeatureLocks,
    activeFeatureLockWhere,
    lockedFlagChanges,
    lockedFlagMessage,
    serializeFeatureLock,
} from '../../domains/workspace/feature-locks'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import { workspaceBookingSettingsSelect } from '../class-bookings/group-booking-fields'
import {
    UpdateWorkspaceSettingsFeature,
    UpdateWorkspaceSettingsFeatureResponse,
} from './update-workspace-settings.feature'

// Validate against the runtime's IANA database. Catches typos like
// "Europe/Mosсow" (Cyrillic с) and unsupported aliases without us shipping
// a 400-entry whitelist.
const isValidIanaTz = (tz: string): boolean => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
    } catch {
        return false
    }
}

@Feature(UpdateWorkspaceSettingsFeature)
export class UpdateWorkspaceSettingsHandler
    implements
        IFeatureHandler<
            UpdateWorkspaceSettingsFeature,
            UpdateWorkspaceSettingsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly modules: ModuleEntitlementService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: UpdateWorkspaceSettingsFeature) {
        // Settings now include who may join without approval, so the handler
        // checks the role itself instead of trusting the route decorator alone.
        await assertWorkspaceAdmin(this.rbac, {
            userId: invokerUserId,
            workspaceId,
            roleName,
            isSuperAdmin,
        })

        if (
            payload.timezone !== undefined &&
            !isValidIanaTz(payload.timezone)
        ) {
            throw new BadRequestError({
                message: 'Неизвестный часовой пояс',
            })
        }

        // Switches the platform pinned stay as pinned while the lock holds.
        const now = new Date()
        const locks = activeFeatureLocks(
            await this.prisma.workspaceFeatureLock.findMany({
                where: { workspaceId, ...activeFeatureLockWhere(now) },
                select: { feature: true, enabled: true, until: true },
            }),
            now,
        )
        const refused = lockedFlagChanges(payload, locks)
        if (refused.length > 0) {
            throw new ForbiddenError({
                message: lockedFlagMessage(
                    refused,
                    await loadClubVocabulary(this.prisma, workspaceId),
                ),
            })
        }

        // The club's own video switch only turns ON with the VIDEO module (a
        // form re-sending an already-on switch is not turning it on).
        if (payload.videosEnabled === true) {
            const current = await this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { videosEnabled: true },
            })
            if (!current?.videosEnabled) {
                await this.modules.assertEntitled(workspaceId, 'VIDEO')
            }
        }

        // coachSeesAllGroups + every *Enabled flag are plain boolean columns —
        // spread the payload straight in (Prisma ignores `undefined`, so absent
        // toggles aren't touched). timezone is pulled out for its validation.
        const { timezone, ...flags } = payload
        const updated = await this.prisma.workspace.update({
            where: { id: workspaceId },
            data: {
                ...flags,
                ...(timezone !== undefined ? { timezone } : {}),
            },
            select: {
                id: true,
                name: true,
                coachSeesAllGroups: true,
                coachesMarkAnyClass: true,
                timezone: true,
                joinAutoApprove: true,
                ...featureFlagSelect,
                ...workspaceBookingSettingsSelect,
            },
        })

        await this.audit.record({
            action: 'workspace.updateSettings',
            targetType: 'workspace',
            targetId: workspaceId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { changes: payload },
        })

        return {
            ...updated,
            lockedFeatures: locks.map(serializeFeatureLock),
        }
    }
}
