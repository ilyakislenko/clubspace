/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs, which is the standard jest ordering. */
const store = new Map<string, string>()
jest.mock("./kv", () => ({
    kvGet: jest.fn(async (k: string) => store.get(k) ?? null),
    kvSet: jest.fn(async (k: string, v: string) => {
        store.set(k, v)
    }),
    kvDelete: jest.fn(async (k: string) => {
        store.delete(k)
    }),
}))
const clearUserLocalData = jest.fn(async () => undefined)
jest.mock("./clear-user-local-data", () => ({
    clearUserLocalData: () => clearUserLocalData(),
}))
const setPlaybackWritesEnabled = jest.fn()
jest.mock("../features/video/playback-progress", () => ({
    setPlaybackWritesEnabled: (v: boolean) => setPlaybackWritesEnabled(v),
}))

import { cleanupOnSignOut, reconcileLocalOwner } from "./local-owner"

beforeEach(() => {
    store.clear()
    jest.clearAllMocks()
})

describe("cleanupOnSignOut", () => {
    it("keeps local data on a forced sign-out", async () => {
        store.set("clubspace.localOwnerId", "u1")
        await cleanupOnSignOut({ wipeLocal: false })
        expect(clearUserLocalData).not.toHaveBeenCalled()
        expect(store.get("clubspace.localOwnerId")).toBe("u1")
    })

    it("wipes local data and the owner marker on an explicit sign-out", async () => {
        store.set("clubspace.localOwnerId", "u1")
        await cleanupOnSignOut({ wipeLocal: true })
        expect(clearUserLocalData).toHaveBeenCalledTimes(1)
        expect(store.has("clubspace.localOwnerId")).toBe(false)
    })
})

describe("reconcileLocalOwner", () => {
    it("wipes when a different user signs in", async () => {
        store.set("clubspace.localOwnerId", "u1")
        await reconcileLocalOwner("u2")
        expect(clearUserLocalData).toHaveBeenCalledTimes(1)
        expect(store.get("clubspace.localOwnerId")).toBe("u2")
        expect(setPlaybackWritesEnabled).toHaveBeenCalledWith(true)
    })

    it("keeps data when the same user signs in", async () => {
        store.set("clubspace.localOwnerId", "u1")
        await reconcileLocalOwner("u1")
        expect(clearUserLocalData).not.toHaveBeenCalled()
    })

    it("keeps data and records the owner when none was stored", async () => {
        await reconcileLocalOwner("u1")
        expect(clearUserLocalData).not.toHaveBeenCalled()
        expect(store.get("clubspace.localOwnerId")).toBe("u1")
    })
})
