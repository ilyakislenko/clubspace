import { Feature, IFeatureHandler } from '@shelfjs/features'

import { UsersService } from '../../domains/users/services/users.service'
import {
    ResendCodeFeature,
    ResendCodeFeatureResponse,
} from './resend-code.feature'

@Feature(ResendCodeFeature)
export class ResendCodeHandler
    implements IFeatureHandler<ResendCodeFeature, ResendCodeFeatureResponse>
{
    constructor(private usersService: UsersService) {}

    async execute({ payload }: ResendCodeFeature) {
        await this.usersService.createCompleteCode(payload)

        return { success: true }
    }
}
