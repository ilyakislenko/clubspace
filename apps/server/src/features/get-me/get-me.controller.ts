import { Controller, Get, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { ActAsAllowed } from '../../shared/decorators/act-as.decorator'
import { SkipConsentCheck } from '../../shared/decorators/skip-consent-check.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetMeFeature,
    GetMeFeatureOutputSchema,
    GetMeFeatureResponse,
} from './get-me.feature'

class GetMeOutput extends createZodDto(GetMeFeatureOutputSchema) {}

@Controller('me')
@UseGuards(AuthGuard)
// The consent screen greets the user by profile, so it reads /me first.
@SkipConsentCheck()
export class GetMeController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    // The app reads the active profile's name while acting for a child.
    @ActAsAllowed()
    @ZodResponse({ type: GetMeOutput })
    async getMe(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<GetMeFeature, GetMeFeatureResponse>(
            new GetMeFeature(user.userId),
        )
    }
}
