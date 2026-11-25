import { announcementSourceLine, mergeFederationItems } from "./announcement-source"

const item = (id: string, over: Partial<{ pinned: boolean; createdAt: string; publishedAt: string | null; org: string }> = {}) => ({
  id,
  pinned: over.pinned ?? false,
  createdAt: over.createdAt ?? "2026-11-01T10:00:00.000Z",
  publishedAt: over.publishedAt ?? null,
  ...(over.org ? { source: { kind: "organization" as const, organizationId: "o1", name: over.org } } : {}),
})

describe("announcementSourceLine", () => {
  it("marks a federation's announcement and nothing else", () => {
    expect(announcementSourceLine(item("a", { org: "Федерация БЖЖ" }))).toBe("От федерации «Федерация БЖЖ»")
    expect(announcementSourceLine(item("b"))).toBeNull()
  })
})

describe("mergeFederationItems", () => {
  it("keeps pinned club items first and merges the federation's by date", () => {
    const merged = mergeFederationItems(
      [
        item("pinned", { pinned: true, createdAt: "2026-10-01T00:00:00.000Z" }),
        item("new", { createdAt: "2026-11-20T00:00:00.000Z" }),
        item("old", { createdAt: "2026-11-01T00:00:00.000Z" }),
      ],
      [item("fed", { org: "Ф", createdAt: "2026-11-02T00:00:00.000Z", publishedAt: "2026-11-10T00:00:00.000Z" })],
    )
    expect(merged.map((a) => a.id)).toEqual(["pinned", "new", "fed", "old"])
  })

  it("leaves the club's list as it is without federation items", () => {
    const club = [item("b", { createdAt: "2026-11-01T00:00:00.000Z" }), item("a", { createdAt: "2026-11-20T00:00:00.000Z" })]
    expect(mergeFederationItems(club, []).map((a) => a.id)).toEqual(["b", "a"])
  })
})
