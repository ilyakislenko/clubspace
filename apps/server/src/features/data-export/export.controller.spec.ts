import { ExportController } from './export.controller'

const build = () => {
    const exportService = {
        membersCsv: jest.fn().mockResolvedValue('members-csv'),
        renewalsCsv: jest.fn().mockResolvedValue('renewals-csv'),
        attendanceCsv: jest.fn().mockResolvedValue('attendance-csv'),
        paymentsCsv: jest
            .fn()
            .mockResolvedValue({ csv: 'payments-csv', from: '2026-10-16', to: '2026-11-15' }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const res = { setHeader: jest.fn() }
    const controller = new ExportController(
        exportService as never,
        audit as never,
    )
    return { controller, exportService, audit, res }
}

const admin = { userId: 'admin-1' } as never

describe('ExportController audit trail', () => {
    it('journals a roster export after building it', async () => {
        const { controller, audit, res } = build()
        await expect(
            controller.members('w1', admin, res as never),
        ).resolves.toBe('members-csv')
        expect(audit.record).toHaveBeenCalledWith({
            action: 'export.members',
            targetType: 'workspace',
            targetId: 'w1',
            workspaceId: 'w1',
            actorId: 'admin-1',
            metadata: {},
        })
    })

    it('journals a renewals export', async () => {
        const { controller, audit, res } = build()
        await controller.renewals('w1', admin, res as never)
        expect(audit.record.mock.calls[0][0].action).toBe('export.renewals')
    })

    it('records the covered range of an attendance export', async () => {
        const { controller, audit, exportService, res } = build()
        await controller.attendance(
            'w1',
            { from: '2026-10-01', to: '2026-10-31' },
            admin,
            res as never,
        )
        // Club-local days: the service resolves them in the club's timezone.
        expect(exportService.attendanceCsv.mock.calls[0][1]).toEqual({
            from: '2026-10-01',
            to: '2026-10-31',
        })
        expect(res.setHeader).toHaveBeenCalledWith(
            'Content-Disposition',
            'attachment; filename="attendance-2026-10-01_2026-10-31.csv"',
        )
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'export.attendance',
            metadata: { from: '2026-10-01', to: '2026-10-31' },
        })
    })

    it('exports the payments journal view: file named after its period, filters in the trail', async () => {
        const { controller, audit, exportService, res } = build()
        const user = { userId: 'admin-1', role: { name: 'admin' }, isSuperAdmin: false } as never
        await expect(
            controller.payments('w1', { method: 'CASH', q: '', groupId: 'g1' }, user, res as never),
        ).resolves.toBe('payments-csv')
        expect(exportService.paymentsCsv).toHaveBeenCalledWith(
            { workspaceId: 'w1', invokerUserId: 'admin-1', roleName: 'admin', isSuperAdmin: false },
            { method: 'CASH', q: '', groupId: 'g1' },
        )
        // No dates asked = the default period the service resolved.
        expect(res.setHeader).toHaveBeenCalledWith(
            'Content-Disposition',
            'attachment; filename="payments-2026-10-16_2026-11-15.csv"',
        )
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'export.payments',
            metadata: { from: '2026-10-16', to: '2026-11-15', method: 'CASH', groupId: 'g1' },
        })
        expect(audit.record.mock.calls[0][0].metadata).not.toHaveProperty('q')
    })

    it('leaves no journal entry when the export fails', async () => {
        const { controller, audit, exportService, res } = build()
        exportService.membersCsv.mockRejectedValue(new Error('db down'))
        await expect(
            controller.members('w1', admin, res as never),
        ).rejects.toThrow('db down')
        expect(audit.record).not.toHaveBeenCalled()
    })
})
