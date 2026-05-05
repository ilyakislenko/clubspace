import { Controller, Get, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    ListRolesFeature,
    ListRolesFeatureOutputSchema,
    ListRolesFeatureResponse,
} from './list-roles.feature'

class ListRolesOutput extends createZodDto(ListRolesFeatureOutputSchema) {}

@Controller('roles')
@UseGuards(AuthGuard)
export class ListRolesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListRolesOutput })
    async listRoles() {
        return await this.bus.execute<
            ListRolesFeature,
            ListRolesFeatureResponse
        >(new ListRolesFeature())
    }
}
