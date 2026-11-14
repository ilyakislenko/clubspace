import {
  AT_RISK_CHIP,
  AT_RISK_LABEL,
  AT_RISK_LEVEL_LABEL,
  AT_RISK_LEVEL_TEXT,
} from "./at-risk"

describe("at-risk labels", () => {
  it("covers every reason with a label and a chip class", () => {
    for (const r of ["lapsed", "newcomer", "absent", "declining"] as const) {
      expect(AT_RISK_LABEL[r]).toBeTruthy()
      expect(AT_RISK_CHIP[r]).toBeTruthy()
    }
  })

  it("covers every score level", () => {
    for (const l of ["high", "medium", "low"] as const) {
      expect(AT_RISK_LEVEL_LABEL[l]).toBeTruthy()
      expect(AT_RISK_LEVEL_TEXT[l]).toBeTruthy()
    }
  })
})
