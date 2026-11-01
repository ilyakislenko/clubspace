// Hours viewed for the VIDEO module, derived from the playback progress the
// players already post (save-video-progress → VideoWatched). There is no
// per-second play log, so this is an approximation, counted per save:
//
//   watched = forward movement of the saved position since the previous save
//             of the same person and video, capped by the wall-clock time
//             between the two saves (× PLAYBACK_SPEED_CAP for 2× playback,
//             + SAVE_SLACK_S for clock jitter); the first save of a video
//             counts at most FIRST_SAVE_CAP_S.
//
// So a forward seek counts only up to the time that really passed, a seek
// back or a replay from the start counts nothing until playback moves
// forward again, and playback the client never reported (a closed app before
// the next save, a player that does not post progress) is not counted. The
// result lands in VideoViewingMonth for the calendar month (UTC) of the save.

const PLAYBACK_SPEED_CAP = 2
const SAVE_SLACK_S = 30
const FIRST_SAVE_CAP_S = 60

export const viewedSecondsSinceLastSave = (
    previous: { position: number; watchedAt: Date } | null,
    position: number,
    now: Date,
): number => {
    if (!previous) {
        return Math.round(Math.min(Math.max(0, position), FIRST_SAVE_CAP_S))
    }
    const moved = position - previous.position
    if (moved <= 0) return 0
    const elapsed = Math.max(0, (now.getTime() - previous.watchedAt.getTime()) / 1000)
    return Math.round(Math.min(moved, elapsed * PLAYBACK_SPEED_CAP + SAVE_SLACK_S))
}
