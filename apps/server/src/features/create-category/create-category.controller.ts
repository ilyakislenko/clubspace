import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateCategoryFeature,
    CreateCategoryFeatureInputSchema,
    CreateCategoryFeatureOutputSchema,
    CreateCategoryFeatureResponse,
} from './create-category.feature'

class CreateCategoryInput extends createZodDto(
    CreateCategoryFeatureInputSchema,
) {}

class CreateCategoryOutput extends createZodDto(
    CreateCategoryFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/categories')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class CreateCategoryController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @ZodResponse({ type: CreateCategoryOutput })
    async createCategory(
        @Param('workspaceId') workspaceId: string,
        @Body() input: CreateCategoryInput,
    ) {
        return await this.bus.execute<
            CreateCategoryFeature,
            CreateCategoryFeatureResponse
        >(new CreateCategoryFeature(input, workspaceId))
    }
}
