import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { UpdateVideoTimestampFeature } from './update-video-timestamp.feature'
import { UpdateVideoTimestampHandler } from './update-video-timestamp.handler'

const EXISTING = {
    id: 'ts1',
    positionSec: 30,
    title: 'SLX Toe Hold',
    video: { duration: 600 },
}

const build = (existing: unknown = EXISTING) => {
    const prisma = {
        videoTimestamp: {
            findFirst: jest.fn().mockResolvedValue(existing),
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
                id: 'ts1',
                videoId: 'v1',
                positionSec: 30,
                title: 'SLX Toe Hold',
                source: 'ocr',
                ...data,
            })),
        },
    }
    const handler = new UpdateVideoTimestampHandler(prisma as never)
    return { handler, prisma }
}

const feature = (payload: { positionSec?: number; title?: string }) =>
    new UpdateVideoTimestampFeature(payload, 'ws1', 'v1', 'ts1')

describe('UpdateVideoTimestampHandler', () => {
    it('refuses a chapter outside the workspace’s video', async () => {
        const { handler, prisma } = build(null)
        await expect(handler.execute(feature({ title: 'X' }))).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(prisma.videoTimestamp.findFirst.mock.calls[0][0].where).toEqual({
            id: 'ts1',
            videoId: 'v1',
            video: { workspaceId: 'ws1' },
        })
        expect(prisma.videoTimestamp.update).not.toHaveBeenCalled()
    })

    it('refuses a position past the end of the video', async () => {
        const { handler, prisma } = build()
        await expect(handler.execute(feature({ positionSec: 601 }))).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.videoTimestamp.update).not.toHaveBeenCalled()
    })

    it('accepts any position while the duration is unknown', async () => {
        const { handler } = build({ ...EXISTING, video: { duration: null } })
        await expect(handler.execute(feature({ positionSec: 5000 }))).resolves.toEqual({
            id: 'ts1',
            positionSec: 5000,
            title: 'SLX Toe Hold',
        })
    })

    it('makes a retitled automatic chapter manual and returns the DTO only', async () => {
        const { handler, prisma } = build()
        const result = await handler.execute(feature({ title: '  SLX Toe Hold Finish  ' }))
        expect(prisma.videoTimestamp.update.mock.calls[0][0]).toEqual({
            where: { id: 'ts1' },
            data: { title: 'SLX Toe Hold Finish', source: 'manual' },
        })
        expect(result).toEqual({ id: 'ts1', positionSec: 30, title: 'SLX Toe Hold Finish' })
    })

    it('makes a moved automatic chapter manual', async () => {
        const { handler, prisma } = build()
        await handler.execute(feature({ positionSec: 42 }))
        expect(prisma.videoTimestamp.update.mock.calls[0][0].data).toEqual({
            positionSec: 42,
            source: 'manual',
        })
    })

    it('leaves the source alone when nothing changes', async () => {
        for (const payload of [{}, { positionSec: 30, title: ' SLX Toe Hold ' }]) {
            const { handler, prisma } = build()
            await handler.execute(feature(payload))
            expect(prisma.videoTimestamp.update.mock.calls[0][0].data).not.toHaveProperty(
                'source',
            )
        }
    })
})
