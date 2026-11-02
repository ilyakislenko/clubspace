import { groupOptionLabel } from "./group-label"

describe("groupOptionLabel", () => {
  it("добавляет зал из объекта gym", () => {
    expect(groupOptionLabel({ name: "Дети Старшие", gym: { name: "Юпитер" } })).toBe(
      "Дети Старшие · Юпитер",
    )
  })
  it("добавляет зал из gymName", () => {
    expect(groupOptionLabel({ name: "Дети", gymName: "Центр" })).toBe("Дети · Центр")
  })
  it("без зала — только название", () => {
    expect(groupOptionLabel({ name: "Дети", gym: null, gymName: null })).toBe("Дети")
  })
})
