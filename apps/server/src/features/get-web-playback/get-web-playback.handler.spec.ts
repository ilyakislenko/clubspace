jest.mock('../../domains/video/services/video.service', () => ({
    VideoService: class {},
}))

import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { GetWebPlaybackFeature } from './get-web-playback.feature'
import { GetWebPlaybackHandler } from './get-web-playback.handler'

// The access gate and TTL live in VideoService.getWebPlayback
// (video.service.spec.ts); the handler must hand it the caller, not trust
// anything else.
const run = (getWebPlayback: jest.Mock) =>
    new GetWebPlaybackHandler({ getWebPlayback } as never).execute(
        new GetWebPlaybackFeature('vid-1', 'u1'),
    )

describe('GetWebPlaybackHandler', () => {
    it('returns the signed URL for the caller', async () => {
        const out = { url: 'https://s/v', mimeType: 'video/mp4', expiresInSeconds: 2000 }
        const getWebPlayback = jest.fn().mockResolvedValue(out)
        await expect(run(getWebPlayback)).resolves.toBe(out)
        expect(getWebPlayback).toHaveBeenCalledWith({ videoId: 'vid-1', userId: 'u1' })
    })

    it('passes a refusal through (locked lesson)', async () => {
        const getWebPlayback = jest
            .fn()
            .mockRejectedValue(new ForbiddenError({ message: 'Сначала посмотрите предыдущий урок' }))
        await expect(run(getWebPlayback)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('passes not-found through', async () => {
        const getWebPlayback = jest
            .fn()
            .mockRejectedValue(new NotFoundError({ message: 'Видео не найдено' }))
        await expect(run(getWebPlayback)).rejects.toBeInstanceOf(NotFoundError)
    })
})
