import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateGymFeature,
    CreateGymFeatureInputSchema,
    CreateGymFeatureOutputSchema,
    CreateGymFeatureResponse,
} from './create-gym.feature'

class CreateGymBody extends createZodDto(CreateGymFeatureInputSchema) {}
class CreateGymOutput extends createZodDto(CreateGymFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/gyms')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class CreateGymController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @ZodResponse({ type: CreateGymOutput })
    async create(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateGymBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<CreateGymFeature, CreateGymFeatureResponse>(
            new CreateGymFeature(body, workspaceId, user.userId),
        )
    }
}
