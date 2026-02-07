import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import {
    createZodDto,
    ZodResponse
} from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetMyWorkspacesFeature,
    GetMyWorkspacesFeatureInputSchema,
    GetMyWorkspacesFeatureOutputSchema,
    GetMyWorkspacesFeatureResponse,
} from './get-my-workspaces.feature'

class GetMyWorkspacesInput extends createZodDto(GetMyWorkspacesFeatureInputSchema) {}

class GetMyWorkspacesOutput extends createZodDto(
    GetMyWorkspacesFeatureOutputSchema,
) {}

@Controller('get-my-workspaces')
export class GetMyWorkspacesController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @UseGuards(AuthGuard)
    @ZodResponse({ type: GetMyWorkspacesOutput })
    async getMyWorkspaces(
        @Body() input: GetMyWorkspacesInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetMyWorkspacesFeature,
            GetMyWorkspacesFeatureResponse
        >(new GetMyWorkspacesFeature(input, user))
    }
}
