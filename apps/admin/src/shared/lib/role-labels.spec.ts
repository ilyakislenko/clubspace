import { formatRoleName } from "./role-labels"

describe("formatRoleName", () => {
  it("maps known role names to Russian labels", () => {
    expect(formatRoleName("user")).toBe("Ученик")
    expect(formatRoleName("head_coach")).toBe("Главный тренер")
    expect(formatRoleName("admin")).toBe("Администратор")
  })

  it("falls back to the raw name for unknown roles", () => {
    expect(formatRoleName("freshly_seeded")).toBe("freshly_seeded")
  })
})
