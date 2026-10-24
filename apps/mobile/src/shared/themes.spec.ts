import { THEMES, type ThemeKey } from "@clubspace/ui-kit/util"

import { resolveAppColors, type ColorScheme } from "./themes"

const SCHEMES: ColorScheme[] = ["light", "dark"]

describe("resolveAppColors", () => {
  const keys = Object.keys(THEMES) as ThemeKey[]

  it.each(keys.flatMap((k) => SCHEMES.map((s) => [k, s] as const)))(
    "%s/%s defines the contrast tokens",
    (key, scheme) => {
      const c = resolveAppColors(key, scheme)
      expect(c.inverseText).toBeTruthy()
      expect(c.accentText).toBeTruthy()
      expect(c.warning).toBeTruthy()
      // Text on a `colors.text` fill must never be invisible (Glass has a
      // transparent background).
      expect(c.inverseText).not.toBe("transparent")
    },
  )

  it("keeps inverseText equal to background wherever background is opaque", () => {
    for (const key of keys) {
      for (const scheme of SCHEMES) {
        const c = resolveAppColors(key, scheme)
        if (c.background !== "transparent" && key !== "neu") {
          expect(c.inverseText).toBe(c.background)
        }
      }
    }
  })
})
