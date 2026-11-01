/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs, which is the standard jest ordering. */
// The resume-guard and completion-ratio rules here decide what the user sees
// as "watched" and where a video resumes — silent-breakage territory. We mock
// the two side-effecting deps (the on-disk cache and the best-effort server
// sync) and exercise the pure decision logic against a fixed progress map.
//
// RESUME_GUARD_SECONDS = 30, COMPLETION_RATIO = 0.9 (see playback-progress.ts).

jest.mock("expo-file-system/legacy", () => ({
    documentDirectory: "/doc/",
    getInfoAsync: jest.fn(async () => ({ exists: true })),
    readAsStringAsync: jest.fn(async () =>
        JSON.stringify({
            "completed-vid": { position: 50, updatedAt: 1, completed: true },
            "midway-vid": { position: 50, updatedAt: 1 },
            "almost-done-vid": { position: 95, updatedAt: 1 },
            "barely-started": { position: 0.5, updatedAt: 1 },
            "near-end": { position: 90, updatedAt: 1 },
        }),
    ),
    writeAsStringAsync: jest.fn(async () => undefined),
}))

const saveVideoProgress = jest.fn(async () => ({}))
jest.mock("../../shared/api/progress", () => ({
    saveVideoProgress: (...args: unknown[]) => saveVideoProgress(...args),
}))

import {
    getCourseProgressSummary,
    getProgressStatus,
    getResumePosition,
    markCompleted,
} from "./playback-progress"

describe("getResumePosition", () => {
    it("returns 0 for an unknown video", async () => {
        expect(await getResumePosition("missing")).toBe(0)
    })

    it("returns 0 once the video is completed", async () => {
        expect(await getResumePosition("completed-vid")).toBe(0)
    })

    it("returns 0 when the saved position is under a second", async () => {
        expect(await getResumePosition("barely-started")).toBe(0)
    })

    it("returns 0 when the position is within the end guard", async () => {
        // 90s into a 100s video — inside the 30s guard, so don't resume.
        expect(await getResumePosition("near-end", 100)).toBe(0)
    })

    it("resumes at the saved position when comfortably mid-video", async () => {
        expect(await getResumePosition("midway-vid", 100)).toBe(50)
    })
})

describe("getProgressStatus", () => {
    it("is unwatched for an unknown video", async () => {
        expect((await getProgressStatus("missing")).status).toBe("unwatched")
    })

    it("is watched when explicitly completed", async () => {
        const s = await getProgressStatus("completed-vid")
        expect(s.status).toBe("watched")
        expect(s.ratio).toBe(1)
    })

    it("is watched once past the 90% completion ratio", async () => {
        // 95 / 100 = 0.95 >= 0.9
        expect((await getProgressStatus("almost-done-vid", 100)).status).toBe(
            "watched",
        )
    })

    it("is in-progress below the completion ratio", async () => {
        const s = await getProgressStatus("midway-vid", 100)
        expect(s.status).toBe("in-progress")
        expect(s.ratio).toBeCloseTo(0.5)
    })

    it("is in-progress with ratio 0 when duration is unknown", async () => {
        const s = await getProgressStatus("barely-started")
        expect(s.status).toBe("in-progress")
        expect(s.ratio).toBe(0)
    })
})

describe("getCourseProgressSummary", () => {
    it("counts completed and past-ratio videos as watched", async () => {
        const summary = await getCourseProgressSummary({
            videos: [
                { id: "completed-vid" }, // completed
                { id: "almost-done-vid", duration: 100 }, // 0.95 → watched
                { id: "midway-vid", duration: 100 }, // 0.5 → not watched
                { id: "missing" }, // no entry
            ],
        })
        expect(summary).toEqual({ watched: 2, total: 4 })
    })
})

describe("markCompleted", () => {
    it("best-effort syncs the completion to the server", async () => {
        await markCompleted("midway-vid", 100)
        expect(saveVideoProgress).toHaveBeenCalledWith(
            expect.objectContaining({ videoId: "midway-vid", completed: true }),
        )
    })

    it("reports the end position when the player reached the end", async () => {
        saveVideoProgress.mockClear()
        await markCompleted("ended-vid", 100)
        expect(saveVideoProgress).toHaveBeenCalledWith({
            videoId: "ended-vid",
            position: 100,
            completed: true,
            duration: 100,
        })
    })

    it("syncs a manual mark from the start", async () => {
        saveVideoProgress.mockClear()
        await markCompleted("manual-vid")
        expect(saveVideoProgress).toHaveBeenCalledWith(
            expect.objectContaining({ videoId: "manual-vid", position: 0 }),
        )
    })
})

describe("writes after a wipe", () => {
    it("ignores saves until sign-in re-enables them", async () => {
        const { clearPlaybackProgress, saveProgress, setPlaybackWritesEnabled } =
            await import("./playback-progress")
        saveVideoProgress.mockClear()
        await clearPlaybackProgress()
        await saveProgress("v1", 100)
        expect(saveVideoProgress).not.toHaveBeenCalled()
        expect(await getResumePosition("v1")).toBe(0)

        setPlaybackWritesEnabled(true)
        await saveProgress("v1", 100)
        expect(saveVideoProgress).toHaveBeenCalledTimes(1)
    })
})
