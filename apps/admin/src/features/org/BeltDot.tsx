// The level's colour as a small dot; no colour, an empty ring.
export function BeltDot({ color, className = "" }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-3 shrink-0 rounded-full border border-border ${className}`}
      style={{ backgroundColor: color ?? "transparent" }}
    />
  )
}
