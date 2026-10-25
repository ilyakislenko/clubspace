import { canDecideRequests, canSeeClubInvite } from "./invite-access"

const ws = (roleName: string, isOwner = false) => ({ roleName, isOwner })

describe("canSeeClubInvite", () => {
  it.each(["admin", "head_coach", "coach"])("lets %s see it", (role) => {
    expect(canSeeClubInvite(ws(role))).toBe(true)
  })
  it("lets the owner see it", () => {
    expect(canSeeClubInvite(ws("user", true))).toBe(true)
  })
  it("hides it from members and with no club", () => {
    expect(canSeeClubInvite(ws("user"))).toBe(false)
    expect(canSeeClubInvite(null)).toBe(false)
    expect(canSeeClubInvite(undefined)).toBe(false)
  })
})

describe("canDecideRequests", () => {
  it.each(["admin", "head_coach"])("lets %s decide", (role) => {
    expect(canDecideRequests(ws(role))).toBe(true)
  })
  it("lets the owner decide", () => {
    expect(canDecideRequests(ws("user", true))).toBe(true)
  })
  it("keeps plain coaches and members out", () => {
    expect(canDecideRequests(ws("coach"))).toBe(false)
    expect(canDecideRequests(ws("user"))).toBe(false)
    expect(canDecideRequests(null)).toBe(false)
  })
})
