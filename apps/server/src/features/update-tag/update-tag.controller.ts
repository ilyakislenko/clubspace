import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    UpdateTagFeature,
    UpdateTagFeatureInputSchema,
    UpdateTagFeatureOutputSchema,
    UpdateTagFeatureResponse,
} from './update-tag.feature'

class UpdateTagInput extends createZodDto(UpdateTagFeatureInputSchema) {}

class UpdateTagOutput extends createZodDto(UpdateTagFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/tags')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class UpdateTagController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':tagId')
    @ZodResponse({ type: UpdateTagOutput })
    async updateTag(
        @Param('workspaceId') workspaceId: string,
        @Param('tagId') tagId: string,
        @Body() input: UpdateTagInput,
    ) {
        return await this.bus.execute<UpdateTagFeature, UpdateTagFeatureResponse>(
            new UpdateTagFeature(input, workspaceId, tagId),
        )
    }
}
