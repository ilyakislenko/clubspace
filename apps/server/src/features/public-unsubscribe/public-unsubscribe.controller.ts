import { Controller, Get, Header, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common'
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { FeaturesBus } from '@shelfjs/features'
import type { Response } from 'express'
import { createZodDto } from 'nestjs-zod'

import { BadRequestError } from '../../shared/errors/shared.errors'
import { trackByClientIp } from '../../shared/guards/club-throttler.guard'
import { escapeHtml } from '../../shared/utils/escape-html'
import {
    UnsubscribeClubMessagesFeature,
    type UnsubscribeClubMessagesFeatureResponse,
    UnsubscribeClubMessagesInputSchema,
} from './unsubscribe-club-messages.feature'

class UnsubscribeClubMessagesQuery extends createZodDto(UnsubscribeClubMessagesInputSchema) {}

const page = (title: string, text: string, form = ''): string => `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" />
<title>${escapeHtml(title)}</title></head>
<body style="font-family: Arial, sans-serif; background-color: #f7f6f9; padding: 30px;">
<div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px;">
<h2 style="color:#18171b; font-size: 22px; margin: 0 0 12px 0;">${escapeHtml(title)}</h2>
<p style="font-size: 15px; color: #3a3940; margin: 0;">${escapeHtml(text)}</p>${form}
</div></body></html>`

// No action: the form posts back to this very URL, token included.
const CONFIRM_FORM = `
<form method="post" style="margin: 24px 0 0 0;">
<button type="submit" style="padding: 12px 24px; background: #5b58d9; color: #fff; border: 0; border-radius: 999px; font-size: 14px; font-weight: 700; cursor: pointer;">Отписаться</button>
</form>`

const INVALID_PAGE = page(
    'Не получилось отписаться',
    'Ссылка недействительна. Отключить письма клуба можно в приложении: Настройки → «Сообщения клуба на e-mail».',
)

// A link this server didn't issue: a page with 400; anything else is a real
// error.
const invalidLink = (e: unknown, res: Response): string => {
    if (!(e instanceof BadRequestError)) throw e
    res.status(HttpStatus.BAD_REQUEST)
    return INVALID_PAGE
}

// Unauthenticated «Отписаться от писем клуба» (the link in a club message
// e-mail and its List-Unsubscribe header). GET only checks the link and asks
// to confirm — mail scanners and link previews open every link; the POST
// writes: the page's button, or the mail client's one-click (RFC 8058, body
// `List-Unsubscribe=One-Click`, which needs no reading). Both answer a page.
// Per IP, like the other public routes.
@Controller('public/unsubscribe')
@ApiTags('Public')
export class PublicUnsubscribeController {
    constructor(private bus: FeaturesBus) {}

    @Get('club-messages')
    @Throttle({ default: { ttl: 60_000, limit: 30, getTracker: trackByClientIp } })
    @Header('Content-Type', 'text/html; charset=utf-8')
    @ApiProduces('text/html')
    @ApiOkResponse({ schema: { type: 'string' } })
    async unsubscribeClubMessagesPage(
        @Query() query: UnsubscribeClubMessagesQuery,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        try {
            await this.bus.execute<UnsubscribeClubMessagesFeature, UnsubscribeClubMessagesFeatureResponse>(
                new UnsubscribeClubMessagesFeature(query, false),
            )
        } catch (e) {
            return invalidLink(e, res)
        }
        return page(
            'Отписаться от писем клуба?',
            'Письма с сообщениями клуба перестанут приходить на этот адрес. Сами сообщения останутся в приложении, в разделе «Сообщения клуба».',
            CONFIRM_FORM,
        )
    }

    @Post('club-messages')
    @Throttle({ default: { ttl: 60_000, limit: 30, getTracker: trackByClientIp } })
    @HttpCode(HttpStatus.OK)
    @Header('Content-Type', 'text/html; charset=utf-8')
    @ApiProduces('text/html')
    @ApiOkResponse({ schema: { type: 'string' } })
    async unsubscribeClubMessages(
        @Query() query: UnsubscribeClubMessagesQuery,
        @Res({ passthrough: true }) res: Response,
    ): Promise<string> {
        try {
            await this.bus.execute<UnsubscribeClubMessagesFeature, UnsubscribeClubMessagesFeatureResponse>(
                new UnsubscribeClubMessagesFeature(query, true),
            )
        } catch (e) {
            return invalidLink(e, res)
        }
        return page(
            'Вы отписались от писем клуба',
            'Письма с сообщениями клуба больше не придут. Сообщения по-прежнему будут в приложении, в разделе «Сообщения клуба».',
        )
    }
}
