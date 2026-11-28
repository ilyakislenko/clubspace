import { Body, Controller, Get, Headers, Ip, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AcceptClubVideoAnswersNoticeFeature,
    type AcceptClubVideoAnswersNoticeFeatureResponse,
    AcceptClubVideoAnswersNoticeInputSchema,
    AskClubVideosFeature,
    type AskClubVideosFeatureResponse,
    AskClubVideosInputSchema,
    AskClubVideosOutputSchema,
    ClubVideoAnswersStateOutputSchema,
    GetClubVideoAnswersStateFeature,
    type GetClubVideoAnswersStateFeatureResponse,
} from './ask-club-videos.feature'

class ClubVideoAnswersStateOutput extends createZodDto(ClubVideoAnswersStateOutputSchema) {}
class AcceptClubVideoAnswersNoticeInput extends createZodDto(AcceptClubVideoAnswersNoticeInputSchema) {}
class AskClubVideosInput extends createZodDto(AskClubVideosInputSchema) {}
class AskClubVideosOutput extends createZodDto(AskClubVideosOutputSchema) {}

// «Спросить ИИ по видео клуба» in the app (Видео → Поиск). Any member: the
// handlers check the club's switch, the video gate and the member's notice.
@Controller('workspaces/:workspaceId/video-answers')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
export class AskClubVideosController {
    constructor(private bus: FeaturesBus) {}

    @Get('state')
    @ZodResponse({ type: ClubVideoAnswersStateOutput })
    async getClubVideoAnswersState(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetClubVideoAnswersStateFeature, GetClubVideoAnswersStateFeatureResponse>(
            new GetClubVideoAnswersStateFeature(workspaceId, user.userId),
        )
    }

    @Post('notice')
    @ZodResponse({ type: ClubVideoAnswersStateOutput })
    async acceptClubVideoAnswersNotice(
        @Param('workspaceId') workspaceId: string,
        @Body() body: AcceptClubVideoAnswersNoticeInput,
        @CurrentUser() user: CurrentUserPayload,
        @Ip() ip: string | undefined,
        @Headers('user-agent') userAgent: string | undefined,
    ) {
        return this.bus.execute<
            AcceptClubVideoAnswersNoticeFeature,
            AcceptClubVideoAnswersNoticeFeatureResponse
        >(new AcceptClubVideoAnswersNoticeFeature(workspaceId, user.userId, body, ip ?? null, userAgent ?? null))
    }

    @Post()
    @ZodResponse({ type: AskClubVideosOutput })
    async askClubVideos(
        @Param('workspaceId') workspaceId: string,
        @Body() body: AskClubVideosInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<AskClubVideosFeature, AskClubVideosFeatureResponse>(
            new AskClubVideosFeature(workspaceId, user.userId, body),
        )
    }
}
