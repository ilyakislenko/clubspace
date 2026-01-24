import { compare } from 'bcrypt'

import { Feature, IFeatureHandler } from '@shelfjs/features'
import { RolesService } from '../../domains/roles/services/roles.service'
import { TokensService } from '../../domains/tokens/services/tokens.service'
import {
    UserNoCompleteCodeError,
    UserNotFoundError,
} from '../../domains/users/errors/users.errors'
import { UsersService } from '../../domains/users/services/users.service'
import { UserBlockedError } from '../../shared/errors/shared.errors'
import {
    InvalidCredentialsError,
    SignInFeature,
    SignInFeatureResponse,
} from './sign-in.feature'

@Feature(SignInFeature)
export class SignInHandler
    implements IFeatureHandler<SignInFeature, SignInFeatureResponse>
{
    constructor(
        private readonly tokensService: TokensService,
        private readonly usersService: UsersService,
        private readonly rolesService: RolesService,
    ) {}

    async execute({ payload }: SignInFeature): Promise<SignInFeatureResponse> {
        const { email, code } = payload

        const user = await this.usersService.getUserByEmail({
            email,
        })

        if (!user) {
            throw new UserNotFoundError({ email })
        }

        if (user.status === 'BLOCKED') {
            throw new UserBlockedError()
        }

        if (!user.completeCode) {
            throw new UserNoCompleteCodeError({ id: user.id })
        }

        const isCodeValid = await compare(code, user.completeCode)

        if (!isCodeValid) {
            throw new InvalidCredentialsError()
        }

        const accessToken = await this.tokensService.generateToken({
            userId: user.id,
        })

        const refreshToken = await this.tokensService.generateStoredToken({
            userId: user.id,
        })

        return {
            userId: user.id,
            accessToken,
            refreshToken,
            expiresAt:
                Math.floor(Date.now() / 1000) +
                this.tokensService.accessTokenTTL,
        }
    }
}
