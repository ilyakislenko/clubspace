import type { TechniqueGroup } from "../../shared/api/techniques"
import { pluralRu } from "../../shared/format-ru"

type Named = { en: string; ru: string | null }

/** «Кимура (Kimura)» — the Russian name first when the glossary has one. */
export const techniqueName = ({ en, ru }: Named): string => {
  if (!ru || ru.toLowerCase() === en.toLowerCase()) return en
  return `${ru.charAt(0).toUpperCase()}${ru.slice(1)} (${en})`
}

/** «3 урока · 2 главы» — how much there is to study. */
export const techniqueCountLabel = (t: { videoCount: number; chapterCount: number }): string => {
  const lessons = `${t.videoCount} ${pluralRu(t.videoCount, "урок", "урока", "уроков")}`
  if (t.chapterCount === 0) return lessons
  return `${lessons} · ${t.chapterCount} ${pluralRu(t.chapterCount, "глава", "главы", "глав")}`
}

/**
 * The catalogue narrowed by the search box (English or Russian name, any
 * case); categories left empty disappear. Works on the cached copy offline.
 */
export const filterTechniqueGroups = (
  groups: readonly TechniqueGroup[],
  query: string,
): TechniqueGroup[] => {
  const q = query.trim().toLowerCase()
  if (!q) return [...groups]
  return groups
    .map((g) => ({
      ...g,
      techniques: g.techniques.filter((t) =>
        [t.en, t.ru ?? ""].some((name) => name.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.techniques.length > 0)
}
