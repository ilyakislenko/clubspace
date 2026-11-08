import {
  clearScheduleFilters,
  loadDirectionFilter,
  loadGymFilter,
  saveDirectionFilter,
  saveGymFilter,
} from "./schedule-filter-store"

const store = new Map<string, string>()

jest.mock("../../shared/kv", () => ({
  kvGet: async (k: string) => store.get(k) ?? null,
  kvSet: async (k: string, v: string) => void store.set(k, v),
  kvDelete: async (k: string) => void store.delete(k),
}))

describe("schedule filter store", () => {
  beforeEach(() => store.clear())

  it("keeps one pick per club", async () => {
    await saveGymFilter("w1", ["g1", "g2"])
    await saveGymFilter("w2", ["g3"])
    await saveGymFilter("w1", [])
    expect(await loadGymFilter("w1")).toEqual([])
    expect(await loadGymFilter("w2")).toEqual(["g3"])
  })

  it("keeps the directions apart from the gyms", async () => {
    await saveGymFilter("w1", ["g1"])
    await saveDirectionFilter("w1", ["d1", "d2"])
    expect(await loadGymFilter("w1")).toEqual(["g1"])
    expect(await loadDirectionFilter("w1")).toEqual(["d1", "d2"])
  })

  it("reads a single stored gym as a one-item list", async () => {
    store.set(
      "clubspace.scheduleGym",
      JSON.stringify({ w1: "g1", w2: ["g2", 7], w3: 5 }),
    )
    expect(await loadGymFilter("w1")).toEqual(["g1"])
    expect(await loadGymFilter("w2")).toEqual(["g2"])
    expect(await loadGymFilter("w3")).toEqual([])
  })

  it("starts from everything on an unreadable entry", async () => {
    store.set("clubspace.scheduleGym", "{nope")
    store.set("clubspace.scheduleDirections", "null")
    expect(await loadGymFilter("w1")).toEqual([])
    expect(await loadDirectionFilter("w1")).toEqual([])
  })

  it("forgets every club's pick on sign-out", async () => {
    await saveGymFilter("w1", ["g1"])
    await saveDirectionFilter("w2", ["d1"])
    await clearScheduleFilters()
    expect(await loadGymFilter("w1")).toEqual([])
    expect(await loadDirectionFilter("w2")).toEqual([])
  })
})
