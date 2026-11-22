import { guardianName } from "./guardians"
import type { MemberGuardian } from "../api/members"

const guardian = (over: Partial<MemberGuardian> = {}): MemberGuardian => ({
  userId: "g1",
  firstname: "Анна",
  lastname: "Петрова",
  email: "anna@example.com",
  phone: "+79990001122",
  relation: "PARENT",
  confirmed: true,
  ...over,
})

describe("guardianName", () => {
  it("joins first and last name, skipping missing parts", () => {
    expect(guardianName(guardian())).toBe("Анна Петрова")
    expect(guardianName(guardian({ firstname: null }))).toBe("Петрова")
    expect(guardianName(guardian({ firstname: null, lastname: null }))).toBe("")
  })
})
