import { Controller, Get, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    ListMyJoinRequestsFeature,
    ListMyJoinRequestsFeatureOutputSchema,
    type ListMyJoinRequestsFeatureResponse,
} from './list-my-join-requests.feature'

class ListMyJoinRequestsOutput extends createZodDto(
    ListMyJoinRequestsFeatureOutputSchema,
) {}

// AuthGuard only, no WorkspaceMemberGuard: these are the clubs the caller is
// NOT a member of (yet).
@Controller('me/join-requests')
@UseGuards(AuthGuard)
export class MyJoinRequestsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListMyJoinRequestsOutput })
    async listMyJoinRequests(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            ListMyJoinRequestsFeature,
            ListMyJoinRequestsFeatureResponse
        >(new ListMyJoinRequestsFeature(user.userId))
    }
}
