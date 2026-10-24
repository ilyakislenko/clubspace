export const RankChip = ({
  levelName,
  color,
  stripes,
}: {
  levelName: string
  color: string | null
  stripes: number
}) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
    <span
      className="inline-block h-3 w-3 rounded-full border border-border"
      style={{ backgroundColor: color ?? "transparent" }}
    />
    {levelName}
    {stripes > 0 ? ` · ${stripes}★` : ""}
  </span>
)
