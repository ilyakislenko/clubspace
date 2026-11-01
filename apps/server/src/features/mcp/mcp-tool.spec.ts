import { z } from 'zod'

import type { AiAccess } from '../../domains/ai-assistant/ai-access'
import { signActionConfirmation, verifyActionConfirmation } from './mcp-actions'
import { McpPeople } from './mcp-people'
import { McpScope } from './mcp-scope'
import { capResult, pageInput, paginate, summarizeArgs, toolInputJsonSchema } from './mcp-tool'

describe('paginate', () => {
    it('pages and points at the next offset', () => {
        const rows = [1, 2, 3, 4, 5]
        expect(paginate(rows, 0, 2)).toEqual({ items: [1, 2], total: 5, nextOffset: 2 })
        expect(paginate(rows, 4, 2)).toEqual({ items: [5], total: 5, nextOffset: null })
        expect(paginate(rows, 10, 2)).toEqual({ items: [], total: 5, nextOffset: null })
    })
})

describe('capResult', () => {
    it('passes small answers through untouched', () => {
        const data = { items: [1, 2] }
        expect(capResult(data, 1000)).toBe(data)
    })

    it('drops trailing items until the answer fits, and says so', () => {
        const items = Array.from({ length: 100 }, (_, i) => ({ i, pad: 'x'.repeat(20) }))
        const capped = capResult({ total: 100, items }, 600)
        expect(JSON.stringify(capped).length).toBeLessThanOrEqual(600)
        expect(capped.truncated).toBe(true)
        expect((capped.items as unknown[]).length).toBeGreaterThan(0)
        expect((capped.items as unknown[]).length).toBeLessThan(100)
        expect(capped.note).toContain('offset')
    })

    it('replaces an oversized answer without a list by a hint', () => {
        expect(capResult({ blob: 'x'.repeat(100) }, 50)).toEqual({
            truncated: true,
            note: expect.any(String),
        })
    })
})

describe('summarizeArgs', () => {
    it('keeps short scalars and shapes of the rest', () => {
        expect(
            summarizeArgs({ query: 'y'.repeat(100), limit: 5, flag: true, ids: [1, 2], nested: { a: 1 } }),
        ).toEqual({ query: 'y'.repeat(80), limit: 5, flag: true, ids: '[2]', nested: 'object' })
    })
})

describe('toolInputJsonSchema', () => {
    it('is an object schema with defaults optional and descriptions kept', () => {
        const schema = toolInputJsonSchema(
            z.object({ query: z.string().describe('поиск'), ...pageInput }),
        )
        expect(schema.type).toBe('object')
        expect(schema.$schema).toBeUndefined()
        expect(schema.required).toEqual(['query'])
        expect((schema.properties as Record<string, { description?: string }>).query.description).toBe('поиск')
    })
})

describe('McpPeople', () => {
    const person = { id: 'u1', firstname: 'Иван', lastname: 'Петров', email: 'i@p.ru', phone: '+79001112233' }

    it('pseudonymizes by default: a ref, nothing else', () => {
        const people = new McpPeople('secret', 'w1', 'PSEUDONYMIZED')
        expect(people.member(person)).toEqual({ ref: people.memberRef('u1') })
        expect(Object.keys(people.staff(person))).toEqual(['ref'])
        expect(JSON.stringify([people.member(person), people.staff(person)])).not.toMatch(/Иван|Петров|i@p|7900/)
    })

    it('adds names and contacts with a personal token, never staff contacts', () => {
        const people = new McpPeople('secret', 'w1', 'PERSONAL')
        expect(people.member(person)).toEqual({
            ref: people.memberRef('u1'),
            name: 'Иван Петров',
            phone: '+79001112233',
            email: 'i@p.ru',
        })
        expect(people.staff(person)).toEqual({ ref: expect.stringMatching(/^c_/), name: 'Иван Петров' })
    })
})

describe('McpScope', () => {
    const access = (directionIds: string[] | null): AiAccess => ({
        workspaceId: 'w1',
        workspaceName: 'Клуб',
        timezone: 'Europe/Moscow',
        ownerId: 'owner',
        userId: 'u1',
        roleName: 'coach',
        isOwner: false,
        directionIds,
    })

    it('reads the whole club with admin scope', () => {
        const scope = new McpScope(access(null))
        expect(scope.isAdmin).toBe(true)
        expect(scope.groups()).toEqual({ workspaceId: 'w1' })
        expect(scope.sessions()).toEqual({ workspaceId: 'w1' })
        expect(scope.allowsDirection(null)).toBe(true)
        expect(scope.students()).toMatchObject({ workspaceId: 'w1', NOT: expect.any(Array) })
        expect(scope.students()).not.toHaveProperty('user')
    })

    it('narrows a direction manager to their directions, club-wide rows excluded', () => {
        const scope = new McpScope(access(['bjj']))
        expect(scope.isAdmin).toBe(false)
        expect(scope.allowsDirection('bjj')).toBe(true)
        expect(scope.allowsDirection('mma')).toBe(false)
        expect(scope.allowsDirection(null)).toBe(false)
        expect(scope.groups()).toEqual({ workspaceId: 'w1', directionId: { in: ['bjj'] } })
        expect(scope.directions()).toEqual({ workspaceId: 'w1', id: { in: ['bjj'] } })
        expect(scope.events()).toEqual({ workspaceId: 'w1', directionId: { in: ['bjj'] } })
        expect(scope.ladders()).toEqual({ workspaceId: 'w1', directionId: { in: ['bjj'] } })
        expect(scope.plans()).toEqual({
            workspaceId: 'w1',
            directions: { some: { directionId: { in: ['bjj'] } } },
        })
        expect(scope.sessions()).toEqual({
            workspaceId: 'w1',
            OR: [
                { group: { directionId: { in: ['bjj'] } } },
                { workspaceEvent: { directionId: { in: ['bjj'] } } },
            ],
        })
        expect(scope.students()).toMatchObject({
            user: { groupMemberships: { some: { group: { workspaceId: 'w1', directionId: { in: ['bjj'] } } } } },
        })
    })
})

describe('action confirmation', () => {
    const now = new Date('2026-11-01T10:00:00Z')
    const args = { member: 'm_0123456789', days: 7 }
    const code = signActionConfirmation('secret', {
        tokenId: 't1',
        tool: 'freeze_abonement',
        args,
        expiresAt: new Date(now.getTime() + 60_000),
    })
    const verify = (over: Partial<{ tokenId: string; tool: string; args: Record<string, unknown>; now: Date }> = {}, value = code) =>
        verifyActionConfirmation('secret', value, { tokenId: 't1', tool: 'freeze_abonement', args, now, ...over })

    it('accepts the same token, tool and arguments in any key order', () => {
        expect(verify()).toBe(true)
        expect(verify({ args: { days: 7, member: 'm_0123456789', confirmation: code } })).toBe(true)
    })

    it.each([
        ['other arguments', { args: { ...args, days: 30 } }],
        ['another token', { tokenId: 't2' }],
        ['another tool', { tool: 'cancel_abonement' }],
        ['an expired code', { now: new Date(now.getTime() + 120_000) }],
    ])('refuses %s', (_label, over) => {
        expect(verify(over)).toBe(false)
    })

    it('refuses a forged or garbled code', () => {
        const [payload] = code.split('.')
        expect(verify({}, `${payload}.forged`)).toBe(false)
        expect(verify({}, 'garbage')).toBe(false)
        expect(verifyActionConfirmation('other-secret', code, { tokenId: 't1', tool: 'freeze_abonement', args, now })).toBe(false)
    })
})
