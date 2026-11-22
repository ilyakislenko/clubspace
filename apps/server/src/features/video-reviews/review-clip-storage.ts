import type { FilesService } from '../../infrastructure/files/services/files.service'
import { reviewClipKeys } from './video-reviews-utils'

export type StoredClip = { id: string; rawBucket: string; hlsBucket: string }

/**
 * Deletes every stored file of the clips — the upload, the renditions and the
 * cover. Best effort: a storage hiccup is logged, never thrown, so the caller's
 * row deletion (the member asked for it) always goes through.
 */
export async function deleteReviewClipFiles(
    files: Pick<FilesService, 'deleteObjectsByPrefix'>,
    clips: readonly StoredClip[],
    log: (message: string) => void = console.error,
): Promise<void> {
    for (const clip of clips) {
        const keys = reviewClipKeys(clip.id)
        for (const [bucket, prefix] of [
            [clip.rawBucket, keys.rawPrefix],
            [clip.hlsBucket, keys.hlsPrefix],
        ] as const) {
            try {
                await files.deleteObjectsByPrefix({ bucket, prefix })
            } catch (err) {
                log(`review clip ${clip.id}: could not delete ${prefix}: ${String(err)}`)
            }
        }
    }
}
