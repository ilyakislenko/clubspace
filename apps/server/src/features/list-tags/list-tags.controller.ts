import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListTagsFeature,
    ListTagsFeatureInputSchema,
    ListTagsFeatureOutputSchema,
    ListTagsFeatureResponse,
} from './list-tags.feature'

class ListTagsQuery extends createZodDto(ListTagsFeatureInputSchema) {}

class ListTagsOutput extends createZodDto(ListTagsFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/tags')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class ListTagsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListTagsOutput })
    async listTags(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListTagsQuery,
    ) {
        return await this.bus.execute<ListTagsFeature, ListTagsFeatureResponse>(
            new ListTagsFeature(query, workspaceId),
        )
    }
}
