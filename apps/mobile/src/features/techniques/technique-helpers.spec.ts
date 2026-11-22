import type { TechniqueGroup } from "../../shared/api/techniques"
import {
  filterTechniqueGroups,
  techniqueCountLabel,
  techniqueName,
} from "./technique-helpers"

const t = (key: string, en: string, ru: string | null) => ({
  key,
  en,
  ru,
  videoCount: 1,
  chapterCount: 0,
  speechCount: 1,
})

const GROUPS: TechniqueGroup[] = [
  {
    category: "submissions",
    label: "Болевые и удушающие",
    techniques: [t("kimura", "Kimura", "кимура"), t("armbar", "Armbar", "рычаг локтя")],
  },
  { category: "sweeps", label: "Свипы", techniques: [t("scissor-sweep", "Scissor Sweep", null)] },
]

describe("techniqueName", () => {
  it("puts the Russian name first", () => {
    expect(techniqueName({ en: "Kimura", ru: "кимура" })).toBe("Кимура (Kimura)")
    expect(techniqueName({ en: "Scissor Sweep", ru: null })).toBe("Scissor Sweep")
    expect(techniqueName({ en: "Omoplata", ru: "omoplata" })).toBe("Omoplata")
  })
})

describe("techniqueCountLabel", () => {
  it("counts lessons, and chapters when there are some", () => {
    expect(techniqueCountLabel({ videoCount: 1, chapterCount: 0 })).toBe("1 урок")
    expect(techniqueCountLabel({ videoCount: 3, chapterCount: 2 })).toBe("3 урока · 2 главы")
    expect(techniqueCountLabel({ videoCount: 11, chapterCount: 5 })).toBe("11 уроков · 5 глав")
    expect(techniqueCountLabel({ videoCount: 2, chapterCount: 1 })).toBe("2 урока · 1 глава")
  })
})

describe("filterTechniqueGroups", () => {
  it("keeps everything for an empty search", () => {
    expect(filterTechniqueGroups(GROUPS, "  ")).toEqual(GROUPS)
  })

  it("matches English or Russian names and drops empty categories", () => {
    expect(filterTechniqueGroups(GROUPS, "РЫЧАГ")).toEqual([
      { ...GROUPS[0], techniques: [GROUPS[0].techniques[1]] },
    ])
    expect(filterTechniqueGroups(GROUPS, "sweep").map((g) => g.category)).toEqual(["sweeps"])
    expect(filterTechniqueGroups(GROUPS, "беримболо")).toEqual([])
  })
})
