import { indexVideoTechniques } from './technique-index'

const build = (video: unknown) => {
    const db = {
        video: { findUnique: jest.fn(async () => video) },
        videoTechniqueMention: {
            deleteMany: jest.fn((args: unknown) => ({ op: 'delete', args })),
            createMany: jest.fn((args: unknown) => ({ op: 'create', args })),
        },
        $transaction: jest.fn(async (ops: unknown[]) => ops),
    }
    return db
}

describe('indexVideoTechniques', () => {
    it('rebuilds the mentions from chapters, speech and the Russian translation', async () => {
        const db = build({
            workspaceId: 'w1',
            workspace: { type: 'GRAPPLING' },
            timestamps: [{ positionSec: 30, title: 'Kimura from Closed Guard' }],
            transcript: {
                segments: [{ from: 12.7, to: 15, text: 'now the kimura grip' }],
                translations: { ru: [{ from: 40, to: 42, text: 'Берём кимуру' }] },
            },
        })
        await expect(indexVideoTechniques(db as never, 'v1')).resolves.toBe(4)
        expect(db.videoTechniqueMention.deleteMany).toHaveBeenCalledWith({
            where: { videoId: 'v1' },
        })
        const rows = (db.videoTechniqueMention.createMany.mock.calls[0] as unknown[])[0] as {
            data: Array<Record<string, unknown>>
        }
        expect(rows.data.map((r) => [r.technique, r.kind, r.atSec, r.matched])).toEqual([
            ['kimura', 'chapter', 30, 'Kimura'],
            ['closed-guard', 'chapter', 30, 'Closed Guard'],
            ['kimura', 'speech', 12, 'kimura'],
            ['kimura', 'speechRu', 40, 'кимуру'],
        ])
        expect(rows.data[0]).toMatchObject({ videoId: 'v1', workspaceId: 'w1' })
        // Delete and insert in one transaction.
        expect(db.$transaction).toHaveBeenCalledTimes(1)
    })

    it('copes with no transcript or translation', async () => {
        const db = build({
            workspaceId: 'w1',
            workspace: { type: 'GRAPPLING' },
            timestamps: [],
            transcript: { segments: [], translations: null },
        })
        await expect(indexVideoTechniques(db as never, 'v1')).resolves.toBe(0)
        const none = build({
            workspaceId: 'w1',
            workspace: { type: 'YOGA' },
            timestamps: [{ positionSec: 5, title: 'Savasana' }],
            transcript: null,
        })
        await expect(indexVideoTechniques(none as never, 'v1')).resolves.toBe(1)
    })

    it('does nothing for a deleted video', async () => {
        const db = build(null)
        await expect(indexVideoTechniques(db as never, 'gone')).resolves.toBe(0)
        expect(db.$transaction).not.toHaveBeenCalled()
    })
})
