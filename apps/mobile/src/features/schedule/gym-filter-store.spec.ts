import { clearGymFilters, loadGymFilter, saveGymFilter } from "./gym-filter-store"

const store = new Map<string, string>()

jest.mock("../../shared/kv", () => ({
  kvGet: async (k: string) => store.get(k) ?? null,
  kvSet: async (k: string, v: string) => void store.set(k, v),
  kvDelete: async (k: string) => void store.delete(k),
}))

describe("gym filter store", () => {
  beforeEach(() => store.clear())

  it("keeps one pick per club", async () => {
    await saveGymFilter("w1", "g1")
    await saveGymFilter("w2", "g2")
    await saveGymFilter("w1", null)
    expect(await loadGymFilter("w1")).toBeNull()
    expect(await loadGymFilter("w2")).toBe("g2")
  })

  it("forgets every club's pick on sign-out", async () => {
    await saveGymFilter("w1", "g1")
    await saveGymFilter("w2", "g2")
    await clearGymFilters()
    expect(await loadGymFilter("w1")).toBeNull()
    expect(await loadGymFilter("w2")).toBeNull()
  })
})
