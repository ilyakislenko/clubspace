const pad = (n: number) => String(n).padStart(2, "0")

/** «YYYY-MM-01» .. today, in the device's calendar — the attendance range for «this month». */
export const monthToDate = (now: Date): { from: string; to: string } => {
  const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  return { from: `${ym}-01`, to: `${ym}-${pad(now.getDate())}` }
}
