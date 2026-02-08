import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListCategoriesFeature,
    ListCategoriesFeatureInputSchema,
    ListCategoriesFeatureOutputSchema,
    ListCategoriesFeatureResponse,
} from './list-categories.feature'

class ListCategoriesQuery extends createZodDto(ListCategoriesFeatureInputSchema) {}

class ListCategoriesOutput extends createZodDto(ListCategoriesFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/categories')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class ListCategoriesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListCategoriesOutput })
    async listCategories(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListCategoriesQuery,
    ) {
        return await this.bus.execute<
            ListCategoriesFeature,
            ListCategoriesFeatureResponse
        >(new ListCategoriesFeature(query, workspaceId))
    }
}
