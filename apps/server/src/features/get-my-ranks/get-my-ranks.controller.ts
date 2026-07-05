import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetMyRanksFeature,
    GetMyRanksOutputSchema,
    type GetMyRanksFeatureResponse,
} from './get-my-ranks.feature'

class MyRanksOutput extends createZodDto(GetMyRanksOutputSchema) {}

// Any workspace member reads their own ranks — no @Roles.
@Controller('workspaces/:workspaceId/me/ranks')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class GetMyRanksController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: MyRanksOutput })
    async getMyRanks(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetMyRanksFeature, GetMyRanksFeatureResponse>(
            new GetMyRanksFeature(workspaceId, user.userId),
        )
    }
}
