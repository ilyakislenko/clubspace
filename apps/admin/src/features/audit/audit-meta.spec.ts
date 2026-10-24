import { formatActor, targetTypeLabel } from "./audit-meta"

describe("formatActor", () => {
  it("prefers the display label, then the email", () => {
    expect(
      formatActor({ actorLabel: "Иван Петров", actorEmail: "i@x.ru" }),
    ).toBe("Иван Петров")
    expect(formatActor({ actorLabel: null, actorEmail: "i@x.ru" })).toBe(
      "i@x.ru",
    )
  })

  it("never leaks a raw id", () => {
    expect(formatActor({ actorId: "3f2a9c1e-1111" })).toBe(
      "Неизвестный пользователь",
    )
  })

  it("falls back to the system placeholder without an actor", () => {
    expect(formatActor({ actorLabel: null, actorEmail: null })).toBe("Система")
  })
})

describe("targetTypeLabel", () => {
  it("maps known target types and falls back to the raw value", () => {
    expect(targetTypeLabel("member")).toBe("Участник")
    expect(targetTypeLabel("mystery")).toBe("mystery")
  })
})
