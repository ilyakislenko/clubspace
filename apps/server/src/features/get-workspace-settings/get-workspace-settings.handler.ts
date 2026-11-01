import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    isWorkspaceEntitled,
    moduleEntitlementSelect,
} from '../../domains/billing/module-entitlement'
import { featureFlagSelect } from '../../domains/workspace/feature-flags'
import {
    activeFeatureLocks,
    activeFeatureLockWhere,
    serializeFeatureLock,
} from '../../domains/workspace/feature-locks'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { workspaceBookingSettingsSelect } from '../class-bookings/group-booking-fields'
import {
    GetWorkspaceSettingsFeature,
    GetWorkspaceSettingsFeatureResponse,
} from './get-workspace-settings.feature'

@Feature(GetWorkspaceSettingsFeature)
export class GetWorkspaceSettingsHandler
    implements
        IFeatureHandler<
            GetWorkspaceSettingsFeature,
            GetWorkspaceSettingsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId }: GetWorkspaceSettingsFeature) {
        const now = new Date()
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: {
                id: true,
                name: true,
                coachSeesAllGroups: true,
                timezone: true,
                joinAutoApprove: true,
                ...featureFlagSelect,
                ...workspaceBookingSettingsSelect,
                ...moduleEntitlementSelect('VIDEO'),
                featureLocks: {
                    where: activeFeatureLockWhere(now),
                    select: { feature: true, enabled: true, until: true },
                },
            },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }
        const { billing, moduleEntitlements, featureLocks, ...settings } =
            workspace
        return {
            ...settings,
            videoModuleEntitled: isWorkspaceEntitled({ billing, moduleEntitlements }),
            lockedFeatures: activeFeatureLocks(featureLocks, now).map(
                serializeFeatureLock,
            ),
        }
    }
}
