import { columnsFor, sizeClassFor } from "./size-class"

describe("sizeClassFor", () => {
  it("classifies by Material window width", () => {
    expect(sizeClassFor(360)).toBe("compact")
    expect(sizeClassFor(599)).toBe("compact")
    expect(sizeClassFor(600)).toBe("medium")
    expect(sizeClassFor(736)).toBe("medium")
    expect(sizeClassFor(959)).toBe("medium")
    expect(sizeClassFor(960)).toBe("expanded")
    expect(sizeClassFor(1120)).toBe("expanded")
  })
})

describe("columnsFor", () => {
  it("defaults to 1 / 2 / 3", () => {
    expect(columnsFor("compact")).toBe(1)
    expect(columnsFor("medium")).toBe(2)
    expect(columnsFor("expanded")).toBe(3)
  })

  it("honours per-class overrides and falls back for the rest", () => {
    expect(columnsFor("expanded", { expanded: 4 })).toBe(4)
    expect(columnsFor("medium", { expanded: 4 })).toBe(2)
    expect(columnsFor("compact", { compact: 2 })).toBe(2)
  })

  it("never returns less than one column", () => {
    expect(columnsFor("medium", { medium: 0 })).toBe(1)
  })
})
