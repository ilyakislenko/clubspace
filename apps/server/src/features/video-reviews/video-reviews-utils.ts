// Pure rules of «Разбор видео»: upload limits, storage keys, statuses.

// A clip is a short piece of drilling or sparring, not a lesson.
export const MAX_REVIEW_CLIP_BYTES = 500 * 1024 * 1024
export const MAX_REVIEW_CLIP_DURATION_SEC = 10 * 60

/** Storage of a clip: the upload, and the HLS renditions + cover (private). */
export const reviewClipKeys = (clipId: string) => ({
    rawPrefix: `raw/review/${clipId}/`,
    rawKey: `raw/review/${clipId}/source`,
    hlsPrefix: `hls/review/${clipId}/`,
})

export type ClipStatus = 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed'
export type RequestStatus = 'open' | 'answered' | 'closed'
// What the member and the coach see.
export type ReviewDisplayStatus =
    | 'uploading'
    | 'processing'
    | 'failed'
    | RequestStatus

export const displayStatus = (
    clipStatus: string,
    requestStatus: string,
): ReviewDisplayStatus => {
    if (clipStatus === 'uploading') return 'uploading'
    if (clipStatus === 'failed') return 'failed'
    if (clipStatus !== 'ready') return 'processing'
    return requestStatus as RequestStatus
}

/**
 * Who may move a request where: staff answer, close or reopen; the member
 * closes their own request or reopens it to ask again. Nothing changes a
 * request whose clip never made it through the upload.
 */
export const canSetStatus = (
    actor: 'owner' | 'staff',
    next: RequestStatus,
): boolean => (actor === 'staff' ? true : next !== 'answered')

/** A moment (no end) or a segment ending after it starts. */
export const isValidCommentRange = (atSec: number, endSec: number | null): boolean =>
    endSec === null || endSec > atSec

/** Coaches see the waiting requests first, then answered, then closed. */
export const REQUEST_STATUS_ORDER: Record<RequestStatus, number> = {
    open: 0,
    answered: 1,
    closed: 2,
}

// A playback token's subject for a clip: never a bare uuid, so a clip token
// can't open a club video's manifest (or the other way round).
export const reviewClipTokenSubject = (clipId: string) => `review-${clipId}`
