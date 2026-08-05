import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { featureFlagSelect } from '../../domains/workspace/feature-flags'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
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
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: UpdateWorkspaceSettingsFeature) {
        if (
            payload.timezone !== undefined &&
            !isValidIanaTz(payload.timezone)
        ) {
            throw new BadRequestError({
                message: 'Неизвестный часовой пояс',
            })
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
                timezone: true,
                ...featureFlagSelect,
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

        return updated
    }
}
