import { Body, Controller, Delete, Get, Headers, Post, Res } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import type { Response } from 'express'

import { McpServerService } from './mcp-server.service'

// The ИИ-ассистент endpoint: Model Context Protocol over Streamable HTTP,
// stateless (docs/mcp.md). Not a REST resource — the club comes from the token,
// not the path, and the bearer is a club token (csai_…), not a user JWT, so
// none of the AuthGuard/WorkspaceMemberGuard chain applies; McpServerService
// authenticates, scopes and audits every call. Kept out of the OpenAPI
// contract: no app calls it.
@ApiExcludeController()
@Controller('mcp')
export class McpController {
    constructor(private readonly mcp: McpServerService) {}

    @Post()
    async handleMcpPost(
        @Body() body: unknown,
        @Headers('authorization') authorization: string | undefined,
        @Headers('mcp-protocol-version') protocolVersion: string | undefined,
        @Res() res: Response,
    ) {
        const outcome = await this.mcp.handleHttp({ authorization, protocolVersion, body })
        for (const [name, value] of Object.entries(outcome.headers ?? {})) {
            res.setHeader(name, value)
        }
        if (outcome.body === undefined) {
            res.status(outcome.status).end()
            return
        }
        res.status(outcome.status).json(outcome.body)
    }

    // Stateless server: no server-to-client SSE stream and no session to end.
    @Get()
    async handleMcpGet(@Res() res: Response) {
        res.setHeader('Allow', 'POST')
        res.status(405).end()
    }

    @Delete()
    async handleMcpDelete(@Res() res: Response) {
        res.setHeader('Allow', 'POST')
        res.status(405).end()
    }
}
