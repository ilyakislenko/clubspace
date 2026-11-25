import { pickerLanding } from "./picker-landing"

describe("pickerLanding", () => {
  const p = (isSuperAdmin: boolean, adminClubIds: string[], organizationIds: string[]) =>
    pickerLanding({ isSuperAdmin, adminClubIds, organizationIds })

  it("opens the only admin club when there is no federation", () => {
    expect(p(false, ["w1"], [])).toEqual({ kind: "club", workspaceId: "w1" })
  })

  it("opens the only federation of an account without admin clubs", () => {
    expect(p(false, [], ["o1"])).toEqual({ kind: "org", organizationId: "o1" })
  })

  it("asks when there is a club and a federation, or several of either", () => {
    expect(p(false, ["w1"], ["o1"])).toEqual({ kind: "list" })
    expect(p(false, [], ["o1", "o2"])).toEqual({ kind: "list" })
    expect(p(false, ["w1", "w2"], [])).toEqual({ kind: "list" })
    expect(p(false, [], [])).toEqual({ kind: "list" })
  })

  it("sends platform staff without clubs to the console, never into a club", () => {
    expect(p(true, [], [])).toEqual({ kind: "platform" })
    expect(p(true, ["w1"], [])).toEqual({ kind: "list" })
    expect(p(true, [], ["o1"])).toEqual({ kind: "list" })
  })
})
