import { Feature, IFeatureHandler } from '@shelfjs/features'

import { MailHealthService } from '../../domains/notifications/services/mail-health.service'
import { UsersService } from '../../domains/users/services/users.service'
import {
    ResendCodeFeature,
    ResendCodeFeatureResponse,
} from './resend-code.feature'

@Feature(ResendCodeFeature)
export class ResendCodeHandler
    implements IFeatureHandler<ResendCodeFeature, ResendCodeFeatureResponse>
{
    constructor(
        private usersService: UsersService,
        private mailHealth: MailHealthService,
    ) {}

    async execute({ payload }: ResendCodeFeature) {
        await this.mailHealth.assertCanSend()
        await this.usersService.createCompleteCode(payload)

        return { success: true }
    }
}
