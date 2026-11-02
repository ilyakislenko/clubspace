import { workspaceTypeLabel } from "./workspace-type"

describe("workspaceTypeLabel", () => {
  it("maps known workspace types to Russian labels", () => {
    expect(workspaceTypeLabel("GRAPPLING")).toBe("Грэпплинг")
    expect(workspaceTypeLabel("CUSTOM")).toBe("Другое")
    expect(workspaceTypeLabel("DANCE")).toBe("Танцы")
  })

  it("falls back to the raw value for unknown types", () => {
    expect(workspaceTypeLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW")
  })
})
