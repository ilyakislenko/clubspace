import { Body, Controller, Patch, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    UpdateMeFeature,
    UpdateMeInputSchema,
    UpdateMeOutputSchema,
    type UpdateMeFeatureResponse,
} from './update-me.feature'

class UpdateMeInput extends createZodDto(UpdateMeInputSchema) {}
class UpdateMeOutput extends createZodDto(UpdateMeOutputSchema) {}

@Controller('me')
@UseGuards(AuthGuard)
export class UpdateMeController {
    constructor(private bus: FeaturesBus) {}

    @Patch()
    @ZodResponse({ type: UpdateMeOutput })
    async updateMe(
        @Body() body: UpdateMeInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<UpdateMeFeature, UpdateMeFeatureResponse>(
            new UpdateMeFeature(body, user.userId),
        )
    }
}
