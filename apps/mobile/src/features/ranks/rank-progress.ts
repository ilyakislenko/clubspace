import type { RankProgressEntry } from "../../shared/api/rank-progress"
import { formatRuDay } from "../../shared/format-ru"

export type RankProgressLine = { title: string; caption: string | null }

// One line under a current-rank card: the grading they are listed for, else
// "ready — tell the coach", else how much of the admission rule is left.
export const rankProgressLine = (
  entry: Pick<
    RankProgressEntry,
    "upcomingGrading" | "ready" | "rule" | "remainingText" | "nextLevel"
  >,
): RankProgressLine | null => {
  const next = entry.nextLevel?.name
  if (entry.upcomingGrading) {
    return {
      title: `Аттестация ${formatRuDay(entry.upcomingGrading.date)}: ${entry.upcomingGrading.levelName}`,
      caption: entry.upcomingGrading.gymName,
    }
  }
  if (entry.ready && next) {
    return {
      title: `Готовы к аттестации на «${next}» — скажите тренеру`,
      caption: null,
    }
  }
  if (entry.rule && entry.remainingText) {
    return {
      title: `До следующей аттестации: ${entry.remainingText}`,
      caption: next ? `Следующий уровень: ${next}` : null,
    }
  }
  return null
}
