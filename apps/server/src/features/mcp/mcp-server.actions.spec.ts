// The confirmation protocol of action tools, with one fake action registered
// and the 'actions' scope switched on — neither is the case in production yet.
import { generateAiToken } from '../../domains/ai-assistant/ai-token'
import { RbacService } from '../../shared/services/rbac.service'
import { McpServerService } from './mcp-server.service'

const mockRun = jest.fn()
const mockPreview = jest.fn()

jest.mock('../../domains/ai-assistant/ai-token', () => ({
    ...jest.requireActual('../../domains/ai-assistant/ai-token'),
    ENABLED_AI_TOKEN_SCOPES: ['read', 'actions'],
}))

jest.mock('./mcp-actions', () => {
    const actual = jest.requireActual('./mcp-actions')
    const { z } = jest.requireActual('zod')
    return {
        ...actual,
        MCP_ACTION_TOOLS: [
            {
                kind: 'action',
                name: 'freeze_abonement',
                title: 'Заморозить абонемент',
                description: 'Тестовое действие',
                input: z.object({ days: z.number().int(), ...actual.confirmationInput }),
                preview: (...args: unknown[]) => mockPreview(...args),
                run: (...args: unknown[]) => mockRun(...args),
            },
        ],
    }
})

const { secret } = generateAiToken()

type RpcBody = {
    result?: {
        tools?: { name: string; annotations?: Record<string, unknown> }[]
        isError?: boolean
        structuredContent?: Record<string, unknown>
    }
    error?: { code: number }
}

const setup = (scopes: string[]) => {
    const prisma = {
        aiAccessToken: {
            findUnique: jest.fn().mockResolvedValue({
                id: 't1',
                workspaceId: 'w1',
                name: 'Claude',
                scopes,
                dataMode: 'PSEUDONYMIZED',
                expiresAt: null,
                revokedAt: null,
                lastUsedAt: new Date(),
                createdById: 'owner',
                createdBy: { status: 'ACTIVE', email: null },
                workspace: { name: 'Клуб', isActive: true, billing: null },
            }),
            update: jest.fn(),
        },
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                name: 'Клуб',
                timezone: 'Europe/Moscow',
                ownerId: 'owner',
                coachSeesAllGroups: true,
            }),
        },
        workspaceMember: { findUnique: jest.fn().mockResolvedValue(null) },
        directionManager: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const audit = { record: jest.fn() }
    const service = new McpServerService(
        prisma as never,
        new RbacService(prisma as never),
        audit as never,
        {} as never,
        {} as never,
        { eval: jest.fn().mockResolvedValue([1, 60_000, 0, 0]) } as never,
    )
    const request = async (method: string, params: Record<string, unknown> = {}) =>
        (
            await service.handleHttp({
                authorization: `Bearer ${secret}`,
                protocolVersion: undefined,
                body: { jsonrpc: '2.0', id: 1, method, params },
            })
        ).body as RpcBody
    return { request, audit }
}

describe('McpServerService — action tools', () => {
    beforeEach(() => {
        mockRun.mockReset().mockResolvedValue({ data: { frozen: true }, rows: 1 })
        mockPreview.mockReset().mockResolvedValue({
            summary: 'Заморозить абонемент на 7 дней',
            effects: ['Окончание сдвинется на 7 дней'],
        })
    })

    it('are invisible and uncallable without the actions scope', async () => {
        const s = setup(['read'])
        const list = await s.request('tools/list')
        expect(list.result!.tools!.map((t) => t.name)).not.toContain('freeze_abonement')
        const call = await s.request('tools/call', { name: 'freeze_abonement', arguments: { days: 7 } })
        expect(call.error?.code).toBe(-32602)
        expect(mockRun).not.toHaveBeenCalled()
    })

    it('preview first, change only with the confirmation for the same arguments', async () => {
        const s = setup(['read', 'actions'])
        const list = await s.request('tools/list')
        const tool = list.result!.tools!.find((t) => t.name === 'freeze_abonement')
        expect(tool!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })

        const first = await s.request('tools/call', { name: 'freeze_abonement', arguments: { days: 7 } })
        expect(first.result!.isError).toBe(false)
        expect(first.result!.structuredContent).toMatchObject({
            requiresConfirmation: true,
            preview: { summary: 'Заморозить абонемент на 7 дней' },
        })
        expect(mockRun).not.toHaveBeenCalled()
        const code = String(first.result!.structuredContent!.confirmation)

        const tampered = await s.request('tools/call', {
            name: 'freeze_abonement',
            arguments: { days: 30, confirmation: code },
        })
        expect(tampered.result!.isError).toBe(true)
        expect(mockRun).not.toHaveBeenCalled()

        const confirmed = await s.request('tools/call', {
            name: 'freeze_abonement',
            arguments: { days: 7, confirmation: code },
        })
        expect(confirmed.result).toMatchObject({ isError: false, structuredContent: { frozen: true } })
        expect(mockRun).toHaveBeenCalledTimes(1)
        expect(mockRun.mock.calls[0][1]).toEqual({ days: 7 })
        expect(s.audit.record).toHaveBeenCalledTimes(3)
    })
})
