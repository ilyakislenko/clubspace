import { groupOptionLabel, namesGym } from "./group-label"

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
  it("не повторяет зал, уже названный в названии группы", () => {
    expect(
      groupOptionLabel({ name: "BJJ Взрослые · Дворец спорта", gym: { name: "СК «Дворец спорта»" } }),
    ).toBe("BJJ Взрослые · Дворец спорта")
    expect(groupOptionLabel({ name: "Дети · Южные Ворота", gymName: "мкр. Южные Ворота" })).toBe(
      "Дети · Южные Ворота",
    )
    expect(
      groupOptionLabel({ name: "Дети · Вершина", gym: { name: "ТЦ «Вершина» (Зелёные Горки)" } }),
    ).toBe("Дети · Вершина")
  })
  it("одноимённые группы разных залов различаются залом", () => {
    expect(groupOptionLabel({ name: "Дети", gym: { name: "СК «Юпитер»" } })).toBe("Дети · СК «Юпитер»")
    expect(groupOptionLabel({ name: "Дети", gym: { name: "СК «Энергетик»" } })).toBe(
      "Дети · СК «Энергетик»",
    )
  })
})

describe("namesGym", () => {
  it("ищет имя зала целыми словами подряд", () => {
    expect(namesGym("BJJ Взрослые · Дворец спорта", "СК «Дворец спорта»")).toBe(true)
    // Подстрока внутри слова — не название зала.
    expect(namesGym("Дети Юпитерские", "СК «Юпитер»")).toBe(false)
    // Слова имени не подряд.
    expect(namesGym("Дворец детей и спорта", "СК «Дворец спорта»")).toBe(false)
  })
  it("однобуквенный зал не считается названным ни в каком названии", () => {
    expect(namesGym("Группа А", "Зал «А»")).toBe(false)
    expect(groupOptionLabel({ name: "Взрослые А", gym: { name: "Зал «А»" } })).toBe(
      "Взрослые А · Зал «А»",
    )
  })
})
