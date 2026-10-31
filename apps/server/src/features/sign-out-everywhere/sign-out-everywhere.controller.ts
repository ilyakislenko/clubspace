import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    SignOutEverywhereFeature,
    SignOutEverywhereFeatureOutputSchema,
    SignOutEverywhereFeatureResponse,
} from './sign-out-everywhere.feature'

class SignOutEverywhereOutput extends createZodDto(
    SignOutEverywhereFeatureOutputSchema,
) {}

@Controller('me')
@UseGuards(AuthGuard)
export class SignOutEverywhereController {
    constructor(private bus: FeaturesBus) {}

    @Post('sign-out-everywhere')
    @ApiTags('Authentication')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: SignOutEverywhereOutput })
    async signOutEverywhere(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            SignOutEverywhereFeature,
            SignOutEverywhereFeatureResponse
        >(new SignOutEverywhereFeature(user.userId))
    }
}
