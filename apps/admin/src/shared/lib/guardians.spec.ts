import {
  guardianName,
  guardiansMatchQuery,
} from "./guardians"
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

describe("guardiansMatchQuery", () => {
  it("matches by guardian name, e-mail or phone", () => {
    expect(guardiansMatchQuery([guardian()], "петр")).toBe(true)
    expect(guardiansMatchQuery([guardian()], "anna@")).toBe(true)
    expect(guardiansMatchQuery([guardian()], "0001122")).toBe(true)
  })

  it("tolerates missing contacts and empty lists", () => {
    expect(
      guardiansMatchQuery(
        [guardian({ firstname: null, lastname: null, email: null, phone: null })],
        "x",
      ),
    ).toBe(false)
    expect(guardiansMatchQuery([], "x")).toBe(false)
  })
})
