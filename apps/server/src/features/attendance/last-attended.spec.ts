import { Logger } from '@nestjs/common'

import { backfillLastAttendedAt, syncLastAttendedAt } from './last-attended'

// Tagged-template calls arrive as (strings, ...values).
const sqlOf = (call: unknown[]) => (call[0] as string[]).join('?')

describe('syncLastAttendedAt', () => {
    it('recomputes the column from attendance for the given members of one club', async () => {
        const prisma = { $executeRaw: jest.fn().mockResolvedValue(2) }

        await syncLastAttendedAt(prisma as never, 'ws-1', ['u1', 'u2'])

        const call = prisma.$executeRaw.mock.calls[0]
        expect(sqlOf(call)).toContain('SET "lastAttendedAt" = (')
        expect(sqlOf(call)).toContain('max(ar."markedAt")')
        expect(call.slice(1)).toEqual(['ws-1', ['u1', 'u2']])
    })

    it('skips the query for no members', async () => {
        const prisma = { $executeRaw: jest.fn() }
        await syncLastAttendedAt(prisma as never, 'ws-1', [])
        expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it('never fails the attendance write it follows', async () => {
        const warn = jest
            .spyOn(Logger.prototype, 'warn')
            .mockImplementation(() => undefined)
        const prisma = { $executeRaw: jest.fn().mockRejectedValue(new Error('deadlock')) }

        await expect(
            syncLastAttendedAt(prisma as never, 'ws-1', ['u1']),
        ).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('deadlock'))
        warn.mockRestore()
    })
})

describe('backfillLastAttendedAt', () => {
    it('fills every membership from its attendance history and returns the count', async () => {
        const prisma = { $executeRaw: jest.fn().mockResolvedValue(7) }
        expect(await backfillLastAttendedAt(prisma as never)).toBe(7)
        const sql = sqlOf(prisma.$executeRaw.mock.calls[0])
        expect(sql).toContain('GROUP BY "workspaceId", "userId"')
        expect(sql).toContain('IS DISTINCT FROM a.last')
    })
})
