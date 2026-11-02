import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import { formatRoleName } from "./role-labels"

const academy = vocabularyForWorkspaceType("GRAPPLING")
const studio = vocabularyForWorkspaceType("DANCE")

describe("formatRoleName", () => {
  it("maps known role names to Russian labels", () => {
    expect(formatRoleName("user", academy)).toBe("Ученик")
    expect(formatRoleName("coach", academy)).toBe("Тренер")
    expect(formatRoleName("head_coach", academy)).toBe("Главный тренер")
    expect(formatRoleName("admin", academy)).toBe("Администратор")
  })

  it("names the coach roles in the club's words", () => {
    expect(formatRoleName("coach", studio)).toBe("Педагог")
    expect(formatRoleName("head_coach", studio)).toBe("Главный педагог")
  })

  it("falls back to the raw name for unknown roles", () => {
    expect(formatRoleName("freshly_seeded", academy)).toBe("freshly_seeded")
  })
})
