import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    GetMyAgendaFeature,
    GetMyAgendaInputSchema,
    GetMyAgendaOutputSchema,
    type GetMyAgendaFeatureResponse,
} from './get-my-agenda.feature'

class GetMyAgendaQuery extends createZodDto(GetMyAgendaInputSchema) {}
class GetMyAgendaOutput extends createZodDto(GetMyAgendaOutputSchema) {}

// AuthGuard only: spans every club of the caller; the handler reads only the
// caller's own live memberships.
@Controller('me/agenda')
@UseGuards(AuthGuard)
export class MyAgendaController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: GetMyAgendaOutput })
    async getMyAgenda(
        @Query() query: GetMyAgendaQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<GetMyAgendaFeature, GetMyAgendaFeatureResponse>(
            new GetMyAgendaFeature(query, user.userId),
        )
    }
}
