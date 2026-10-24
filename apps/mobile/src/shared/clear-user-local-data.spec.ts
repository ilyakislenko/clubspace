/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs, which is the standard jest ordering. */
jest.mock("expo-file-system/legacy", () => ({
    documentDirectory: "/doc/",
    deleteAsync: jest.fn(async () => undefined),
}))
jest.mock("./api/progress", () => ({ saveVideoProgress: jest.fn() }))
jest.mock("./api/videos", () => ({
    listMyFavorites: jest.fn(),
    setVideoFavorite: jest.fn(),
}))

import * as FileSystem from "expo-file-system/legacy"

import { clearUserLocalData } from "./clear-user-local-data"

describe("clearUserLocalData", () => {
    it("wipes per-user files and downloads but keeps device preferences", async () => {
        await clearUserLocalData()
        const deleted = (FileSystem.deleteAsync as jest.Mock).mock.calls.map(
            (c) => c[0] as string,
        )
        for (const name of [
            "favorites.json",
            "favorites-pending.json",
            "recents.json",
            "notes.json",
            "bookmarks.json",
            "pinned-courses.json",
            "playback-progress.json",
            "offline/",
        ]) {
            expect(deleted.some((p) => p.endsWith(name))).toBe(true)
        }
        expect(deleted.some((p) => p.endsWith("/preferences.json"))).toBe(false)
        expect(deleted.some((p) => p.endsWith("drill-config.json"))).toBe(false)
    })
})
