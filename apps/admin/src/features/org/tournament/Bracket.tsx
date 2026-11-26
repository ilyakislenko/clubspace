"use client"

import { cn } from "@clubspace/ui-kit/util"

import type { TournamentBracket, TournamentCompetitor, TournamentMatch } from "../../../shared/api/tournaments"
import { CARD_HEIGHT, COLUMN_WIDTH, layoutBracket } from "./bracket-layout"
import { competitorName, methodShort, placeLabel } from "./tournament-view"

const HEADER_HEIGHT = 28

// The division's bracket (design §7): rounds as columns («1/8 · 1/4 · 1/2 ·
// Финал»), two-line cards, the winner bold with a short method, a bye as the
// name with a muted «без схватки». Scrolls both ways on a tablet; plain
// HTML + one SVG for the connectors, no chart library.
export function Bracket({
  bracket,
  orgType,
  onSelect,
}: {
  bracket: TournamentBracket
  orgType: string
  // Tap on a ready or decided match.
  onSelect: (match: TournamentMatch) => void
}) {
  if (bracket.matches.length === 0) {
    const lone = bracket.entries[0]
    return lone ? (
      <div className="max-w-sm rounded-lg border border-border px-4 py-3 text-sm">
        <div className="font-medium">{competitorName(lone)}</div>
        <div className="text-xs text-muted-foreground">
          {[lone.clubName, "без соперника", lone.place ? placeLabel(lone.place) : null].filter(Boolean).join(" · ")}
        </div>
      </div>
    ) : null
  }
  const layout = layoutBracket(bracket.matches)
  return (
    <div className="overflow-auto rounded-lg border border-border bg-muted/20 p-4" data-bracket>
      <div className="relative" style={{ width: layout.width, height: layout.height + HEADER_HEIGHT }}>
        {layout.columns.map((c) => (
          <div
            key={c.round}
            className="absolute text-xs font-medium text-muted-foreground"
            style={{ left: c.left, top: 0, width: COLUMN_WIDTH }}
          >
            {c.label}
          </div>
        ))}
        <svg
          className="pointer-events-none absolute left-0 text-border"
          style={{ top: HEADER_HEIGHT }}
          width={layout.width}
          height={layout.height}
          aria-hidden
        >
          {layout.links.map((l, i) => {
            const midX = (l.from.x + l.to.x) / 2
            return (
              <path
                key={i}
                d={`M ${l.from.x} ${l.from.y} H ${midX} V ${l.to.y} H ${l.to.x}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              />
            )
          })}
        </svg>
        {layout.columns.flatMap((c) =>
          c.matches.map(({ match, top }) => (
            <MatchCard
              key={match.id}
              match={match}
              orgType={orgType}
              style={{ left: c.left, top: top + HEADER_HEIGHT, width: COLUMN_WIDTH, height: CARD_HEIGHT }}
              onSelect={onSelect}
            />
          )),
        )}
      </div>
    </div>
  )
}

function MatchCard({
  match,
  orgType,
  style,
  onSelect,
}: {
  match: TournamentMatch
  orgType: string
  style: React.CSSProperties
  onSelect: (match: TournamentMatch) => void
}) {
  const decided = match.winnerEntryId !== null
  const tappable = !match.isBye && (match.ready || decided)
  const winnerSide = match.winnerEntryId === null ? null : match.winnerEntryId === match.entryA?.entryId ? "A" : "B"
  const tail = decided && !match.isBye ? methodShort(match, winnerSide, orgType) : null
  const side = (c: TournamentCompetitor | null, s: "A" | "B") => (
    <Side
      competitor={c}
      winner={winnerSide === s && !match.isBye}
      loser={winnerSide !== null && winnerSide !== s}
      tail={winnerSide === s ? tail : null}
      bye={match.isBye && c !== null}
      empty={match.isBye && c === null}
    />
  )
  const body = (
    <>
      {side(match.entryA, "A")}
      <div className="h-px bg-border" />
      {side(match.entryB, "B")}
    </>
  )
  const className = cn(
    "absolute flex flex-col overflow-hidden rounded-md border bg-background text-left",
    match.ready ? "border-primary/60" : "border-border",
  )
  return tappable ? (
    <button
      type="button"
      className={cn(className, "transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring")}
      style={style}
      onClick={() => onSelect(match)}
    >
      {body}
    </button>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  )
}

function Side({
  competitor,
  winner,
  loser,
  tail,
  bye,
  empty,
}: {
  competitor: TournamentCompetitor | null
  winner: boolean
  loser: boolean
  tail: string | null
  bye: boolean
  empty: boolean
}) {
  if (empty) return <div className="flex-1" />
  return (
    <div className="flex min-h-0 w-full flex-1 items-center gap-2 px-2.5">
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm leading-4", winner && "font-semibold", loser && "text-muted-foreground")}>
          {competitor ? competitorName(competitor) : <span className="text-muted-foreground">—</span>}
        </div>
        <div className="truncate text-[11px] leading-4 text-muted-foreground">
          {bye ? "без схватки" : (competitor?.clubName ?? "")}
        </div>
      </div>
      {tail && <span className="shrink-0 text-xs text-muted-foreground">{tail}</span>}
    </div>
  )
}
