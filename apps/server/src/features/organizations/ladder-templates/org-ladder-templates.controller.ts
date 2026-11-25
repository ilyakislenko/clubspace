import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../../shared/decorators/current-user.decorator'
import { ORG_STAFF, OrgRoles } from '../../../shared/decorators/org-roles.decorator'
import { AuthGuard } from '../../../shared/guards/auth.guard'
import { OrganizationsEnabledGuard } from '../../../shared/guards/organizations-enabled.guard'
import { OrganizationMemberGuard } from '../../../shared/guards/organization-member.guard'
import {
    CreateOrgLadderTemplateLevelFeature,
    CreateOrgLadderTemplateLevelInputSchema,
    CreateOrgLadderTemplateLevelOutputSchema,
    type CreateOrgLadderTemplateLevelFeatureResponse,
} from './create-org-ladder-template-level.feature'
import {
    CreateOrgLadderTemplateFeature,
    CreateOrgLadderTemplateInputSchema,
    CreateOrgLadderTemplateOutputSchema,
    type CreateOrgLadderTemplateFeatureResponse,
} from './create-org-ladder-template.feature'
import {
    DeleteOrgLadderTemplateLevelFeature,
    DeleteOrgLadderTemplateLevelOutputSchema,
    type DeleteOrgLadderTemplateLevelFeatureResponse,
} from './delete-org-ladder-template-level.feature'
import {
    DeleteOrgLadderTemplateFeature,
    DeleteOrgLadderTemplateOutputSchema,
    type DeleteOrgLadderTemplateFeatureResponse,
} from './delete-org-ladder-template.feature'
import {
    ListOrgLadderTemplatesFeature,
    ListOrgLadderTemplatesInputSchema,
    ListOrgLadderTemplatesOutputSchema,
    type ListOrgLadderTemplatesFeatureResponse,
} from './list-org-ladder-templates.feature'
import {
    UpdateOrgLadderTemplateLevelFeature,
    UpdateOrgLadderTemplateLevelInputSchema,
    UpdateOrgLadderTemplateLevelOutputSchema,
    type UpdateOrgLadderTemplateLevelFeatureResponse,
} from './update-org-ladder-template-level.feature'
import {
    UpdateOrgLadderTemplateFeature,
    UpdateOrgLadderTemplateInputSchema,
    UpdateOrgLadderTemplateOutputSchema,
    type UpdateOrgLadderTemplateFeatureResponse,
} from './update-org-ladder-template.feature'

class ListOrgLadderTemplatesQuery extends createZodDto(ListOrgLadderTemplatesInputSchema) {}
class ListOrgLadderTemplatesOutput extends createZodDto(ListOrgLadderTemplatesOutputSchema) {}
class CreateOrgLadderTemplateInput extends createZodDto(CreateOrgLadderTemplateInputSchema) {}
class OrgLadderTemplateOutputDto extends createZodDto(CreateOrgLadderTemplateOutputSchema) {}
class UpdateOrgLadderTemplateInput extends createZodDto(UpdateOrgLadderTemplateInputSchema) {}
class UpdateOrgLadderTemplateOutput extends createZodDto(UpdateOrgLadderTemplateOutputSchema) {}
class DeleteOrgLadderTemplateOutput extends createZodDto(DeleteOrgLadderTemplateOutputSchema) {}
class CreateOrgLadderTemplateLevelInput extends createZodDto(
    CreateOrgLadderTemplateLevelInputSchema,
) {}
class CreateOrgLadderTemplateLevelOutput extends createZodDto(
    CreateOrgLadderTemplateLevelOutputSchema,
) {}
class UpdateOrgLadderTemplateLevelInput extends createZodDto(
    UpdateOrgLadderTemplateLevelInputSchema,
) {}
class UpdateOrgLadderTemplateLevelOutput extends createZodDto(
    UpdateOrgLadderTemplateLevelOutputSchema,
) {}
class DeleteOrgLadderTemplateLevelOutput extends createZodDto(
    DeleteOrgLadderTemplateLevelOutputSchema,
) {}

// «Стандарты»: ladder templates clubs adopt as an editable copy.
@Controller('orgs/:organizationId/ladder-templates')
@UseGuards(OrganizationsEnabledGuard, AuthGuard, OrganizationMemberGuard)
export class OrgLadderTemplatesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: ListOrgLadderTemplatesOutput })
    async listOrgLadderTemplates(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Query() query: ListOrgLadderTemplatesQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            ListOrgLadderTemplatesFeature,
            ListOrgLadderTemplatesFeatureResponse
        >(new ListOrgLadderTemplatesFeature(query, organizationId, user.userId, user.isSuperAdmin))
    }

    @Post()
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: OrgLadderTemplateOutputDto })
    async createOrgLadderTemplate(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Body() body: CreateOrgLadderTemplateInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CreateOrgLadderTemplateFeature,
            CreateOrgLadderTemplateFeatureResponse
        >(new CreateOrgLadderTemplateFeature(body, organizationId, user.userId, user.isSuperAdmin))
    }

    @Patch(':templateId')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: UpdateOrgLadderTemplateOutput })
    async updateOrgLadderTemplate(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('templateId', ParseUUIDPipe) templateId: string,
        @Body() body: UpdateOrgLadderTemplateInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UpdateOrgLadderTemplateFeature,
            UpdateOrgLadderTemplateFeatureResponse
        >(
            new UpdateOrgLadderTemplateFeature(
                body,
                organizationId,
                templateId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':templateId')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: DeleteOrgLadderTemplateOutput })
    async deleteOrgLadderTemplate(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('templateId', ParseUUIDPipe) templateId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeleteOrgLadderTemplateFeature,
            DeleteOrgLadderTemplateFeatureResponse
        >(
            new DeleteOrgLadderTemplateFeature(
                organizationId,
                templateId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':templateId/levels')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: CreateOrgLadderTemplateLevelOutput })
    async createOrgLadderTemplateLevel(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('templateId', ParseUUIDPipe) templateId: string,
        @Body() body: CreateOrgLadderTemplateLevelInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            CreateOrgLadderTemplateLevelFeature,
            CreateOrgLadderTemplateLevelFeatureResponse
        >(
            new CreateOrgLadderTemplateLevelFeature(
                body,
                organizationId,
                templateId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':templateId/levels/:levelId')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: UpdateOrgLadderTemplateLevelOutput })
    async updateOrgLadderTemplateLevel(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('templateId', ParseUUIDPipe) templateId: string,
        @Param('levelId', ParseUUIDPipe) levelId: string,
        @Body() body: UpdateOrgLadderTemplateLevelInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            UpdateOrgLadderTemplateLevelFeature,
            UpdateOrgLadderTemplateLevelFeatureResponse
        >(
            new UpdateOrgLadderTemplateLevelFeature(
                body,
                organizationId,
                templateId,
                levelId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':templateId/levels/:levelId')
    @OrgRoles(ORG_STAFF)
    @ZodResponse({ type: DeleteOrgLadderTemplateLevelOutput })
    async deleteOrgLadderTemplateLevel(
        @Param('organizationId', ParseUUIDPipe) organizationId: string,
        @Param('templateId', ParseUUIDPipe) templateId: string,
        @Param('levelId', ParseUUIDPipe) levelId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeleteOrgLadderTemplateLevelFeature,
            DeleteOrgLadderTemplateLevelFeatureResponse
        >(
            new DeleteOrgLadderTemplateLevelFeature(
                organizationId,
                templateId,
                levelId,
                user.userId,
                user.isSuperAdmin,
            ),
        )
    }
}
