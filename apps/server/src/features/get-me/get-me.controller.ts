import { Controller, Get, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetMeFeature,
    GetMeFeatureOutputSchema,
    GetMeFeatureResponse,
} from './get-me.feature'

class GetMeOutput extends createZodDto(GetMeFeatureOutputSchema) {}

@Controller('me')
@UseGuards(AuthGuard)
export class GetMeController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: GetMeOutput })
    async getMe(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<GetMeFeature, GetMeFeatureResponse>(
            new GetMeFeature(user.userId),
        )
    }
}
