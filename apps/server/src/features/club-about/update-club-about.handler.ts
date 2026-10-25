import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { normalizePhone } from '../../shared/utils/phone'
import { serializeClubAbout } from './schemas'
import {
    UpdateClubAboutFeature,
    UpdateClubAboutFeatureResponse,
} from './update-club-about.feature'

@Feature(UpdateClubAboutFeature)
export class UpdateClubAboutHandler
    implements
        IFeatureHandler<UpdateClubAboutFeature, UpdateClubAboutFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: UpdateClubAboutFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Менять информацию о клубе может только администратор клуба',
        )

        const contacts = payload.contacts.map((c) => {
            const phone = normalizePhone(c.phone)
            if (phone === null) {
                throw new BadRequestError({
                    message: `Телефон «${c.phone}» не похож на номер — укажите номер с кодом страны, например +7 952 884-94-20`,
                })
            }
            return { label: c.label, phone }
        })

        const updated = await this.prisma.workspace.update({
            where: { id: workspaceId },
            data: {
                aboutContacts: contacts,
                aboutLinks: payload.links,
                aboutRules: payload.rules ? payload.rules : null,
                aboutUpdatedAt: new Date(),
            },
            select: {
                aboutContacts: true,
                aboutLinks: true,
                aboutRules: true,
                aboutUpdatedAt: true,
            },
        })

        await this.audit.record({
            action: 'workspace.updateAbout',
            targetType: 'workspace',
            targetId: workspaceId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                contacts: contacts.length,
                links: payload.links.length,
                hasRules: Boolean(payload.rules),
            },
        })

        this.realtime.invalidate(workspaceId, ['about'])
        return serializeClubAbout(updated)
    }
}
