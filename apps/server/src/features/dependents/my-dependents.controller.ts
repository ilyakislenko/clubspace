import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    Ip,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import {
    AddMyDependentFeature,
    type AddMyDependentFeatureResponse,
    AddMyDependentInputSchema,
    ConfirmMyDependentFeature,
    type ConfirmMyDependentFeatureResponse,
    ConfirmMyDependentInputSchema,
    DeleteMyDependentFeature,
    type DeleteMyDependentFeatureResponse,
    ListMyDependentsFeature,
    type ListMyDependentsFeatureResponse,
    ListMyDependentsOutputSchema,
    RemoveMyDependentOutputSchema,
    UnlinkMyDependentFeature,
    type UnlinkMyDependentFeatureResponse,
    UpdateMyDependentFeature,
    type UpdateMyDependentFeatureResponse,
    UpdateMyDependentInputSchema,
} from './my-dependents.feature'
import { MyDependentOutputSchema } from './schemas'

class AddMyDependentInput extends createZodDto(AddMyDependentInputSchema) {}
class ConfirmMyDependentInput extends createZodDto(
    ConfirmMyDependentInputSchema,
) {}
class UpdateMyDependentInput extends createZodDto(
    UpdateMyDependentInputSchema,
) {}
class ListMyDependentsOutput extends createZodDto(
    ListMyDependentsOutputSchema,
) {}
class MyDependentOutput extends createZodDto(MyDependentOutputSchema) {}
class RemoveMyDependentOutput extends createZodDto(
    RemoveMyDependentOutputSchema,
) {}

// The guardian's children («Дети» in the app). AuthGuard only and no
// @ActAsAllowed: these always act as the signed-in guardian, so a request
// carrying X-Act-As is refused rather than run for the child.
@Controller('me/dependents')
@UseGuards(AuthGuard)
export class MyDependentsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListMyDependentsOutput })
    async listMyDependents(@CurrentUser() user: CurrentUserPayload) {
        return await this.bus.execute<
            ListMyDependentsFeature,
            ListMyDependentsFeatureResponse
        >(new ListMyDependentsFeature(user.userId))
    }

    @Post()
    @ZodResponse({ type: MyDependentOutput })
    async addMyDependent(
        @Body() body: AddMyDependentInput,
        @CurrentUser() user: CurrentUserPayload,
        @Ip() ip: string | undefined,
        @Headers('user-agent') userAgent: string | undefined,
    ) {
        return await this.bus.execute<
            AddMyDependentFeature,
            AddMyDependentFeatureResponse
        >(
            new AddMyDependentFeature(
                body,
                user.userId,
                ip ?? null,
                userAgent ?? null,
            ),
        )
    }

    @Post(':dependentId/confirm')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: MyDependentOutput })
    async confirmMyDependent(
        @Param('dependentId', ParseUUIDPipe) dependentId: string,
        @Body() body: ConfirmMyDependentInput,
        @CurrentUser() user: CurrentUserPayload,
        @Ip() ip: string | undefined,
        @Headers('user-agent') userAgent: string | undefined,
    ) {
        return await this.bus.execute<
            ConfirmMyDependentFeature,
            ConfirmMyDependentFeatureResponse
        >(
            new ConfirmMyDependentFeature(
                body,
                user.userId,
                dependentId,
                ip ?? null,
                userAgent ?? null,
            ),
        )
    }

    @Patch(':dependentId')
    @ZodResponse({ type: MyDependentOutput })
    async updateMyDependent(
        @Param('dependentId', ParseUUIDPipe) dependentId: string,
        @Body() body: UpdateMyDependentInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UpdateMyDependentFeature,
            UpdateMyDependentFeatureResponse
        >(new UpdateMyDependentFeature(body, user.userId, dependentId))
    }

    @Delete(':dependentId/guardianship')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: RemoveMyDependentOutput })
    async unlinkMyDependent(
        @Param('dependentId', ParseUUIDPipe) dependentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            UnlinkMyDependentFeature,
            UnlinkMyDependentFeatureResponse
        >(new UnlinkMyDependentFeature(user.userId, dependentId))
    }

    @Delete(':dependentId')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: RemoveMyDependentOutput })
    async deleteMyDependent(
        @Param('dependentId', ParseUUIDPipe) dependentId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            DeleteMyDependentFeature,
            DeleteMyDependentFeatureResponse
        >(new DeleteMyDependentFeature(user.userId, dependentId))
    }
}
