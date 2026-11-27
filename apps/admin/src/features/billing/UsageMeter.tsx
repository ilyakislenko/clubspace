// One usage row of the «Тариф» and «Лимиты» pages: label, «X из N» and a bar
// that turns amber from 80% and red at the cap. No percent (a quota without a
// cap) — no bar.
export function UsageMeter({
  label,
  usedLabel,
  percent,
}: {
  label: string
  usedLabel: string
  percent?: number | null
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{usedLabel}</span>
      </div>
      {percent != null && (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${
              percent < 80 ? "bg-primary" : percent < 100 ? "bg-amber-500" : "bg-destructive"
            }`}
            style={{ width: `${Math.max(percent, 2)}%` }}
          />
        </div>
      )}
    </div>
  )
}
