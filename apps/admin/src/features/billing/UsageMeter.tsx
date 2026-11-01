// One usage bar of the «Тариф» page: label, «X из N» and a bar that turns
// amber from 80% and red at the cap.
export function UsageMeter({
  label,
  usedLabel,
  percent,
}: {
  label: string
  usedLabel: string
  percent: number
}) {
  const tone =
    percent < 80 ? "bg-primary" : percent < 100 ? "bg-amber-500" : "bg-destructive"
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{usedLabel}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      </div>
    </div>
  )
}
