import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    AI_TOKEN_EXPIRY_DAYS,
    aiTokenExpiresAt,
    ENABLED_AI_TOKEN_SCOPES,
    generateAiToken,
} from '../../domains/ai-assistant/ai-token'
import { resolveAiAccess } from '../../domains/ai-assistant/ai-access'
import { AI_PERSONAL_DATA_WARNING } from '../../domains/ai-assistant/personal-data-warning'
import { AuditService } from '../../domains/audit/services/audit.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateAiTokenFeature,
    CreateAiTokenFeatureResponse,
    ListAiTokensFeature,
    ListAiTokensFeatureResponse,
    RevokeAiTokenFeature,
    RevokeAiTokenFeatureResponse,
} from './ai-tokens.feature'
import { aiTokenInclude, canRevokeAiToken, serializeAiToken } from './schemas'
import { displayName } from '../attendance/schemas'

// More live tokens than this in one club is a leak waiting to happen, not a
// use case: one per assistant and person is plenty.
export const MAX_ACTIVE_AI_TOKENS = 20

export const OWNER_ONLY_PERSONAL_MESSAGE =
    'Режим «с персональными данными» может включить только владелец клуба'

const IP_MAX = 64
const USER_AGENT_MAX = 512

export const mcpUrl = (): string =>
    `${environment.rootUrl.replace(/\/+$/, '')}/mcp`

@Feature(ListAiTokensFeature)
export class ListAiTokensHandler
    implements IFeatureHandler<ListAiTokensFeature, ListAiTokensFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListAiTokensFeature): Promise<ListAiTokensFeatureResponse> {
        const access = await resolveAiAccess(this.prisma, this.rbac, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        })
        // Admin scope sees every token of the club (and can revoke it); a
        // direction manager only their own.
        const rows = await this.prisma.aiAccessToken.findMany({
            where: {
                workspaceId: f.workspaceId,
                ...(access.directionIds === null
                    ? {}
                    : { createdById: access.userId }),
            },
            include: aiTokenInclude,
            orderBy: { createdAt: 'desc' },
            take: 200,
        })
        const now = new Date()
        return {
            data: rows.map((r) => serializeAiToken(r, access, now)),
            mcpUrl: mcpUrl(),
            canUsePersonalData: access.isOwner,
            personalDataWarning: { ...AI_PERSONAL_DATA_WARNING },
            expiryDaysOptions: [...AI_TOKEN_EXPIRY_DAYS],
            rateLimitPerMinute: environment.ai.mcpRateLimitPerMinute,
        }
    }
}

@Feature(CreateAiTokenFeature)
export class CreateAiTokenHandler
    implements IFeatureHandler<CreateAiTokenFeature, CreateAiTokenFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: CreateAiTokenFeature): Promise<CreateAiTokenFeatureResponse> {
        const access = await resolveAiAccess(this.prisma, this.rbac, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        })
        const { payload } = f

        const disabled = payload.scopes.filter(
            (s) => !ENABLED_AI_TOKEN_SCOPES.includes(s),
        )
        if (disabled.length > 0) {
            throw new BadRequestError({
                message:
                    'Действия через ИИ-ассистента пока недоступны — выдайте токен только на чтение',
            })
        }
        if (
            payload.expiresInDays !== null &&
            !(AI_TOKEN_EXPIRY_DAYS as readonly number[]).includes(payload.expiresInDays)
        ) {
            throw new BadRequestError({
                message: `Срок действия: ${AI_TOKEN_EXPIRY_DAYS.join(', ')} дней или бессрочно`,
            })
        }

        const personal = payload.dataMode === 'PERSONAL'
        if (personal) {
            if (!access.isOwner) {
                throw new ForbiddenError({ message: OWNER_ONLY_PERSONAL_MESSAGE })
            }
            // Counts only for the text the owner saw, like the offer.
            if (payload.personalDataWarningVersion === undefined) {
                throw new BadRequestError({
                    message: 'Примите предупреждение о передаче персональных данных',
                })
            }
            if (payload.personalDataWarningVersion !== AI_PERSONAL_DATA_WARNING.version) {
                throw new ConflictError({
                    message:
                        'Текст предупреждения обновился. Откройте его заново и примите текущую редакцию.',
                })
            }
        }

        const now = new Date()
        const active = await this.prisma.aiAccessToken.count({
            where: {
                workspaceId: f.workspaceId,
                revokedAt: null,
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
        })
        if (active >= MAX_ACTIVE_AI_TOKENS) {
            throw new BadRequestError({
                message: `В клубе уже ${MAX_ACTIVE_AI_TOKENS} действующих токенов — отзовите ненужные`,
            })
        }

        const creator = await this.prisma.user.findUniqueOrThrow({
            where: { id: f.invokerUserId },
            select: { firstname: true, lastname: true, email: true },
        })
        const generated = generateAiToken()
        const scopes = [...new Set(payload.scopes)]
        const expiresAt = aiTokenExpiresAt(now, payload.expiresInDays)

        const row = await this.prisma.$transaction(async (tx) => {
            const token = await tx.aiAccessToken.create({
                data: {
                    workspaceId: f.workspaceId,
                    createdById: f.invokerUserId,
                    name: payload.name,
                    tokenHash: generated.hash,
                    tokenPrefix: generated.prefix,
                    scopes,
                    dataMode: payload.dataMode,
                    expiresAt,
                },
                include: aiTokenInclude,
            })
            if (personal) {
                await tx.aiDataTransferAcceptance.create({
                    data: {
                        workspaceId: f.workspaceId,
                        userId: f.invokerUserId,
                        userEmail: creator.email,
                        userName: displayName(creator).slice(0, 255),
                        warningVersion: AI_PERSONAL_DATA_WARNING.version,
                        tokenId: token.id,
                        ip: f.ip?.slice(0, IP_MAX) ?? null,
                        userAgent: f.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
                    },
                })
            }
            return token
        })

        if (personal) {
            await this.audit.record({
                action: 'ai.personalDataAccept',
                targetType: 'aiToken',
                targetId: row.id,
                workspaceId: f.workspaceId,
                actorId: f.invokerUserId,
                actorEmail: creator.email,
                metadata: { warningVersion: AI_PERSONAL_DATA_WARNING.version },
            })
        }
        await this.audit.record({
            action: 'ai.tokenCreate',
            targetType: 'aiToken',
            targetId: row.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            actorEmail: creator.email,
            metadata: {
                name: row.name,
                dataMode: row.dataMode,
                scopes,
                expiresAt: expiresAt?.toISOString() ?? null,
            },
        })

        return {
            token: serializeAiToken(row, access, now),
            secret: generated.secret,
        }
    }
}

@Feature(RevokeAiTokenFeature)
export class RevokeAiTokenHandler
    implements IFeatureHandler<RevokeAiTokenFeature, RevokeAiTokenFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: RevokeAiTokenFeature): Promise<RevokeAiTokenFeatureResponse> {
        const access = await resolveAiAccess(this.prisma, this.rbac, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        })
        const row = await this.prisma.aiAccessToken.findFirst({
            where: { id: f.tokenId, workspaceId: f.workspaceId },
            include: aiTokenInclude,
        })
        if (!row) throw new NotFoundError({ message: 'Токен не найден' })
        if (!canRevokeAiToken(access, row)) {
            throw new ForbiddenError({
                message: 'Отозвать чужой токен может только администратор клуба',
            })
        }
        const now = new Date()
        // A double tap: already revoked, nothing to record.
        if (row.revokedAt) return serializeAiToken(row, access, now)

        const updated = await this.prisma.aiAccessToken.update({
            where: { id: row.id },
            data: { revokedAt: now, revokedById: f.invokerUserId },
            include: aiTokenInclude,
        })
        await this.audit.record({
            action: 'ai.tokenRevoke',
            targetType: 'aiToken',
            targetId: row.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { name: row.name, dataMode: row.dataMode },
        })
        return serializeAiToken(updated, access, now)
    }
}
