// Formats a whole-minutes duration as "Х ч Y мин" — dropping a zero minute, and
// the hours part under an hour. Used for schedule slot / session lengths.
// (Distinct from content/course-detail's formatDuration, which renders a video
// length given in *seconds* as m:ss.)
export const formatMinutes = (min: number): string => {
  if (min < 60) return `${min} мин`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`
}
