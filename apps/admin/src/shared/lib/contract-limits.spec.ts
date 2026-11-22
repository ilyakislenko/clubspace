import { FORM_LIMITS, readLimit, type ContractLimit } from "./contract-limits"

const rows: [string, ContractLimit][] = Object.entries(FORM_LIMITS).flatMap(
  ([form, fields]) =>
    Object.entries(fields as Record<string, ContractLimit>).map(
      ([name, limit]): [string, ContractLimit] => [`${form}.${name}`, limit],
    ),
)

describe("FORM_LIMITS", () => {
  // A form checks one limit per field but may submit it to several endpoints
  // (create + update, freeze + approve). When one of them changes alone the
  // form would refuse what the other accepts — the fix is on the server.
  it.each(rows)("%s matches every body the form submits it in", (_, limit) => {
    for (const body of limit.bodies) {
      expect(readLimit(limit.kind, body, limit.field)).toEqual({
        min: limit.min,
        max: limit.max,
      })
    }
    expect(limit.min).toBeLessThanOrEqual(limit.max)
  })
})

describe("readLimit", () => {
  const body = {
    properties: {
      // z.number().int().positive().max(3650) — OpenAPI 3.0 form.
      days: { type: "integer", minimum: 0, exclusiveMinimum: true, maximum: 3650 },
      // The same on a nullable field — 3.1 form.
      count: { type: "integer", exclusiveMinimum: 0, maximum: 1000, nullable: true },
      name: { type: "string", maxLength: 255 },
      tags: { type: "array", maxItems: 10 },
      free: { type: "string" },
    },
  }

  it.each([
    ["int", "days", { min: 1, max: 3650 }],
    ["int", "count", { min: 1, max: 1000 }],
    ["text", "name", { min: 0, max: 255 }],
    ["items", "tags", { min: 0, max: 10 }],
  ] as const)("%s %s", (kind, field, expected) => {
    expect(readLimit(kind, body, field)).toEqual(expected)
  })

  it("refuses a field the contract does not bound", () => {
    expect(() => readLimit("text", body, "free")).toThrow()
    expect(() => readLimit("int", body, "missing")).toThrow()
  })
})
