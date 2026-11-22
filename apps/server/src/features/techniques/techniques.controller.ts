import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { type RoleName, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    GetTechniqueFeature,
    GetTechniqueFeatureOutputSchema,
    GetTechniqueFeatureResponse,
} from './get-technique.feature'
import {
    ListTechniquesFeature,
    ListTechniquesFeatureInputSchema,
    ListTechniquesFeatureOutputSchema,
    ListTechniquesFeatureResponse,
} from './list-techniques.feature'

class ListTechniquesQuery extends createZodDto(ListTechniquesFeatureInputSchema) {}
class ListTechniquesOutput extends createZodDto(ListTechniquesFeatureOutputSchema) {}
class GetTechniqueOutput extends createZodDto(GetTechniqueFeatureOutputSchema) {}

// «Техники»: the club sport's technique catalogue over the lessons the member
// may watch, and where each technique is taught.
@Controller('workspaces/:workspaceId/techniques')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class TechniquesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListTechniquesOutput })
    async listTechniques(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListTechniquesQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ListTechniquesFeature, ListTechniquesFeatureResponse>(
            new ListTechniquesFeature(user.userId, workspaceId, query),
        )
    }

    @Get(':techniqueKey')
    @ZodResponse({ type: GetTechniqueOutput })
    async getTechnique(
        @Param('workspaceId') workspaceId: string,
        @Param('techniqueKey') techniqueKey: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        const isStaff =
            user.isSuperAdmin || STAFF_ROLES.includes((user.role?.name ?? '') as RoleName)
        return await this.bus.execute<GetTechniqueFeature, GetTechniqueFeatureResponse>(
            new GetTechniqueFeature(user.userId, workspaceId, techniqueKey, isStaff),
        )
    }
}
