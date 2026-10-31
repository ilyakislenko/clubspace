import { ExportController } from './export.controller'

const build = () => {
    const exportService = {
        membersCsv: jest.fn().mockResolvedValue('members-csv'),
        renewalsCsv: jest.fn().mockResolvedValue('renewals-csv'),
        attendanceCsv: jest.fn().mockResolvedValue('attendance-csv'),
        revenueCsv: jest.fn().mockResolvedValue('revenue-csv'),
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
        expect(exportService.attendanceCsv.mock.calls[0][1]).toEqual({
            from: new Date('2026-10-01T00:00:00.000Z'),
            to: new Date('2026-10-31T23:59:59.999Z'),
        })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'export.attendance',
            metadata: { from: '2026-10-01', to: '2026-10-31' },
        })
    })

    it('records an open-ended revenue export without bounds', async () => {
        const { controller, audit, res } = build()
        await controller.revenue('w1', { from: '2026-10-01' }, admin, res as never)
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'export.revenue',
            metadata: { from: '2026-10-01' },
        })
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
