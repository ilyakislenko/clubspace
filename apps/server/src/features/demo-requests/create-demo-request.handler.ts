import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationsService } from '../../domains/notifications/services/notifications.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { demoRequestEmail } from './demo-request-utils'
import {
    CreateDemoRequestFeature,
    CreateDemoRequestFeatureResponse,
} from './demo-requests.feature'

export const DEMO_CONSENT_REQUIRED =
    'Нужно согласие на обработку контактных данных'

// Stores the request, then mails the platform owner (SUPER_ADMIN_EMAIL). The
// row is what matters: a mail queue that is down must not lose the lead or
// show the visitor an error, so a failed enqueue is only logged.
@Feature(CreateDemoRequestFeature)
export class CreateDemoRequestHandler
    implements
        IFeatureHandler<CreateDemoRequestFeature, CreateDemoRequestFeatureResponse>
{
    private readonly logger = new Logger(CreateDemoRequestHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationsService,
    ) {}

    async execute({ payload }: CreateDemoRequestFeature) {
        const received = { status: 'received' as const }
        // A bot filled the hidden field: answer like a success so it learns
        // nothing, store and send nothing.
        if (payload.website?.trim()) return received
        if (!payload.consent) {
            throw new BadRequestError({ message: DEMO_CONSENT_REQUIRED })
        }

        const row = await this.prisma.demoRequest.create({
            data: {
                name: payload.name,
                clubName: payload.clubName,
                city: payload.city || null,
                contact: payload.contact,
                studentsCount: payload.studentsCount ?? null,
                comment: payload.comment || null,
                consentAt: new Date(),
            },
        })

        const consoleUrl = environment.adminUrl
            ? `${environment.adminUrl.replace(/\/+$/, '')}/platform`
            : null
        try {
            await this.notifications.sendEmailToAddress({
                to: environment.adminEmail,
                ...demoRequestEmail(row, consoleUrl),
            })
        } catch (error) {
            this.logger.warn(
                `demo request ${row.id} saved, owner e-mail not queued: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        }
        return received
    }
}
