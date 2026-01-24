import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import {
    EmailTemplateNotFoundError,
    EmailTemplateRenderError,
} from '../errors/email-templates.errors'

@Injectable()
export class EmailTemplatesService {
    constructor(private readonly prisma: PrismaService) {}

    async createTemplate(payload: {
        key: string
        content: string
        skipIfExists?: boolean
    }) {
        const { key, content } = payload

        await this.prisma.emailTemplate.upsert({
            where: { key: key.toLowerCase() },
            update: {
                content: payload.skipIfExists ? undefined : content,
            },
            create: {
                key: key.toLowerCase(),
                content,
            },
        })
    }

    async getTemplate(payload: {
        key: string
        data: Record<string, string | number | boolean>
    }) {
        const { key, data } = payload

        const template = await this.prisma.emailTemplate.findUnique({
            where: { key: key.toLowerCase() },
            select: {
                content: true,
            },
        })

        if (!template) {
            throw new EmailTemplateNotFoundError({ key })
        }

        try {
            const renderedContent = this.renderTemplate(template.content, data)

            return {
                content: renderedContent,
            }
        } catch (error) {
            throw new EmailTemplateRenderError({
                key,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }

    private renderTemplate(
        template: string,
        data: Record<string, string | number | boolean>,
    ): string {
        return template.replace(/\{\{(\w+)\}\}/g, (match, variableName) => {
            const value = data[variableName]
            return value !== undefined ? String(value) : match
        })
    }
}
