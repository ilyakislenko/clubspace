import { memberStatusLabel } from "./member-status"

describe("memberStatusLabel", () => {
  it("maps known statuses to Russian labels", () => {
    expect(memberStatusLabel("ACTIVE")).toBe("Активен")
    expect(memberStatusLabel("INVITED")).toBe("Ожидает одобрения")
    expect(memberStatusLabel("SUSPENDED")).toBe("Приостановлен")
    expect(memberStatusLabel("BLOCKED")).toBe("Заблокирован")
  })

  it("falls back to the raw value for unknown statuses", () => {
    expect(memberStatusLabel("NEW_STATUS")).toBe("NEW_STATUS")
  })
})
