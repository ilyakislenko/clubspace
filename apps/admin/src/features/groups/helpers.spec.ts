import { type WorkspaceMember } from "../../shared/api/members"
import { matchesMemberQuery } from "./helpers"

const member = (over: Partial<WorkspaceMember>): WorkspaceMember =>
  ({
    userId: "u1",
    email: "ivan@example.com",
    firstname: "Иван",
    lastname: "Петров",
    ...over,
  }) as WorkspaceMember

describe("matchesMemberQuery", () => {
  it("matches everything on an empty query", () => {
    expect(matchesMemberQuery(member({}), "  ")).toBe(true)
  })

  it("matches by name or email, case-insensitively", () => {
    expect(matchesMemberQuery(member({}), "пЕтр")).toBe(true)
    expect(matchesMemberQuery(member({}), "IVAN@")).toBe(true)
  })

  it("rejects non-matching queries", () => {
    expect(matchesMemberQuery(member({}), "сидоров")).toBe(false)
  })
})
