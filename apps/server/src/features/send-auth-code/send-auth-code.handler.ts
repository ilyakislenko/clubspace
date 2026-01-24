import { Feature, IFeatureHandler } from '@shelfjs/features'

import { UserNotFoundError } from '../../domains/users/errors/users.errors'
import { UsersService } from '../../domains/users/services/users.service'
import {
    SendAuthCodeFeature,
    SendAuthCodeFeatureResponse,
} from './send-auth-code.feature'

@Feature(SendAuthCodeFeature)
export class SendAuthCodeHandler
    implements
        IFeatureHandler<SendAuthCodeFeature, SendAuthCodeFeatureResponse>
{
    constructor(
        private userService: UsersService,
    ) {}

    async execute({ payload }: SendAuthCodeFeature) {
        const { email } = payload

        try {
            const user = await this.userService.getUserByEmail({ email })

            if (!user) {
                throw new UserNotFoundError({ email })
            }

            await this.userService.createCompleteCode({ userId: user.id })

            return { new: false }
        } catch (error) {
            if (error instanceof UserNotFoundError) {
                const { id } = await this.userService.createUser({
                    email,
                    language: payload.language,
                })

                await this.userService.createCompleteCode({ userId: id })

                return { new: true }
            }

            throw error
        }
    }
}
