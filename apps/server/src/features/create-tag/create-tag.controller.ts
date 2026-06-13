import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateTagFeature,
    CreateTagFeatureInputSchema,
    CreateTagFeatureOutputSchema,
    CreateTagFeatureResponse,
} from './create-tag.feature'

class CreateTagInput extends createZodDto(CreateTagFeatureInputSchema) {}

class CreateTagOutput extends createZodDto(CreateTagFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/tags')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class CreateTagController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @ZodResponse({ type: CreateTagOutput })
    async createTag(
        @Param('workspaceId') workspaceId: string,
        @Body() input: CreateTagInput,
    ) {
        return await this.bus.execute<CreateTagFeature, CreateTagFeatureResponse>(
            new CreateTagFeature(input, workspaceId),
        )
    }
}
