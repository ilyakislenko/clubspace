import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AcceptPersonalTrainingFeature,
    AcceptPersonalTrainingInputSchema,
    type AcceptPersonalTrainingFeatureResponse,
} from './accept-personal-training.feature'
import {
    CancelPersonalTrainingFeature,
    type CancelPersonalTrainingFeatureResponse,
} from './cancel-personal-training.feature'
import {
    ClosePersonalTrainingInputSchema,
    DeclinePersonalTrainingFeature,
    type DeclinePersonalTrainingFeatureResponse,
} from './decline-personal-training.feature'
import {
    GetPersonalTrainingFeature,
    type GetPersonalTrainingFeatureResponse,
} from './get-personal-training.feature'
import {
    GetPersonalTrainingFormFeature,
    GetPersonalTrainingFormOutputSchema,
    type GetPersonalTrainingFormFeatureResponse,
} from './get-personal-training-form.feature'
import {
    ListPersonalTrainingsFeature,
    ListPersonalTrainingsInputSchema,
    ListPersonalTrainingsOutputSchema,
    type ListPersonalTrainingsFeatureResponse,
} from './list-personal-trainings.feature'
import {
    ProposePersonalTrainingTimeFeature,
    ProposePersonalTrainingTimeInputSchema,
    type ProposePersonalTrainingTimeFeatureResponse,
} from './propose-personal-training-time.feature'
import {
    RequestPersonalTrainingFeature,
    RequestPersonalTrainingInputSchema,
    type RequestPersonalTrainingFeatureResponse,
} from './request-personal-training.feature'
import { PersonalTrainingOutputSchema } from './schemas'
import {
    SetPersonalTrainingOfferFeature,
    SetPersonalTrainingOfferInputSchema,
    SetPersonalTrainingOfferOutputSchema,
    type SetPersonalTrainingOfferFeatureResponse,
} from './set-personal-training-offer.feature'

class PersonalTrainingFormOutput extends createZodDto(
    GetPersonalTrainingFormOutputSchema,
) {}
class SetPersonalTrainingOfferInput extends createZodDto(
    SetPersonalTrainingOfferInputSchema,
) {}
class PersonalTrainingOfferOutput extends createZodDto(
    SetPersonalTrainingOfferOutputSchema,
) {}
class ListPersonalTrainingsQuery extends createZodDto(
    ListPersonalTrainingsInputSchema,
) {}
class ListPersonalTrainingsOutput extends createZodDto(
    ListPersonalTrainingsOutputSchema,
) {}
class PersonalTrainingOutput extends createZodDto(
    PersonalTrainingOutputSchema,
) {}
class RequestPersonalTrainingInput extends createZodDto(
    RequestPersonalTrainingInputSchema,
) {}
class AcceptPersonalTrainingInput extends createZodDto(
    AcceptPersonalTrainingInputSchema,
) {}
class ProposePersonalTrainingTimeInput extends createZodDto(
    ProposePersonalTrainingTimeInputSchema,
) {}
class ClosePersonalTrainingInput extends createZodDto(
    ClosePersonalTrainingInputSchema,
) {}

// Member-tier routes carry no @Roles: any active member may request, and the
// handlers resolve whether the caller is the member, the coach, or an admin
// acting for the coach (anyone else gets 404). Offer and propose are coach-only.
@Controller('workspaces/:workspaceId/personal-trainings')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class PersonalTrainingsController {
    constructor(private bus: FeaturesBus) {}

    @Get('form')
    @ZodResponse({ type: PersonalTrainingFormOutput })
    async getPersonalTrainingForm(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetPersonalTrainingFormFeature,
            GetPersonalTrainingFormFeatureResponse
        >(
            new GetPersonalTrainingFormFeature(
                workspaceId,
                user.userId,
            ),
        )
    }

    @Put('offer')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: PersonalTrainingOfferOutput })
    async setPersonalTrainingOffer(
        @Param('workspaceId') workspaceId: string,
        @Body() body: SetPersonalTrainingOfferInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SetPersonalTrainingOfferFeature,
            SetPersonalTrainingOfferFeatureResponse
        >(
            new SetPersonalTrainingOfferFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get()
    @ZodResponse({ type: ListPersonalTrainingsOutput })
    async listPersonalTrainings(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListPersonalTrainingsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListPersonalTrainingsFeature,
            ListPersonalTrainingsFeatureResponse
        >(
            new ListPersonalTrainingsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get(':requestId')
    @ZodResponse({ type: PersonalTrainingOutput })
    async getPersonalTraining(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetPersonalTrainingFeature,
            GetPersonalTrainingFeatureResponse
        >(
            new GetPersonalTrainingFeature(
                workspaceId,
                requestId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post()
    @ZodResponse({ type: PersonalTrainingOutput })
    async requestPersonalTraining(
        @Param('workspaceId') workspaceId: string,
        @Body() body: RequestPersonalTrainingInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RequestPersonalTrainingFeature,
            RequestPersonalTrainingFeatureResponse
        >(
            new RequestPersonalTrainingFeature(
                body,
                workspaceId,
                user.userId,
            ),
        )
    }

    @Post(':requestId/accept')
    @ZodResponse({ type: PersonalTrainingOutput })
    async acceptPersonalTraining(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @Body() body: AcceptPersonalTrainingInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AcceptPersonalTrainingFeature,
            AcceptPersonalTrainingFeatureResponse
        >(
            new AcceptPersonalTrainingFeature(
                body,
                workspaceId,
                requestId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':requestId/propose')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: PersonalTrainingOutput })
    async proposePersonalTrainingTime(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @Body() body: ProposePersonalTrainingTimeInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ProposePersonalTrainingTimeFeature,
            ProposePersonalTrainingTimeFeatureResponse
        >(
            new ProposePersonalTrainingTimeFeature(
                body,
                workspaceId,
                requestId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':requestId/decline')
    @ZodResponse({ type: PersonalTrainingOutput })
    async declinePersonalTraining(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @Body() body: ClosePersonalTrainingInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeclinePersonalTrainingFeature,
            DeclinePersonalTrainingFeatureResponse
        >(
            new DeclinePersonalTrainingFeature(
                body,
                workspaceId,
                requestId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':requestId/cancel')
    @ZodResponse({ type: PersonalTrainingOutput })
    async cancelPersonalTraining(
        @Param('workspaceId') workspaceId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @Body() body: ClosePersonalTrainingInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CancelPersonalTrainingFeature,
            CancelPersonalTrainingFeatureResponse
        >(
            new CancelPersonalTrainingFeature(
                body,
                workspaceId,
                requestId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
