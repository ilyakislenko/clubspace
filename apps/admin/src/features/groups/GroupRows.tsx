"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"

import { cap } from "@clubspace/ui-kit/brand"

import type { GroupSummary } from "../../shared/api/groups"
import { personName } from "../../shared/lib/analytics"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { DirectionDot } from "../directions/DirectionChip"
import { weekLabel } from "./week-label"

/**
 * Compact group rows (name · hall · coach · students · days); a row opens the
 * group card. `showGym` off on the gym card, where every row is that hall.
 */
export function GroupRows({
  workspaceId,
  groups,
  showGym = true,
}: {
  workspaceId: string
  groups: GroupSummary[]
  showGym?: boolean
}) {
  const vocabulary = useVocabulary()
  const router = useRouter()
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Группа</th>
            {showGym && <th className="px-3 py-2 font-medium">Зал</th>}
            <th className="px-3 py-2 font-medium">{cap(vocabulary.coach.nom)}</th>
            <th className="px-3 py-2 text-right font-medium">Учеников</th>
            <th className="px-3 py-2 font-medium">Расписание</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map((g) => {
            const href = `/workspace/${workspaceId}/groups/${g.id}`
            const assistants = g.coaches.filter((c) => c.role === "assistant").length
            const week = weekLabel(g.week)
            return (
              <tr key={g.id} onClick={() => router.push(href)} className="cursor-pointer hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Link
                    href={href}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-2 font-medium hover:underline"
                  >
                    {g.direction && (
                      <span title={g.direction.name} className="inline-flex">
                        <DirectionDot color={g.direction.color} />
                      </span>
                    )}
                    {g.name}
                  </Link>
                  {g.bookingMode === "BOOKING" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      запись на {vocabulary.session.acc}
                    </span>
                  )}
                </td>
                {showGym && (
                  <td className="px-3 py-2 text-muted-foreground">
                    {g.gym?.name ?? <span className="text-amber-700">Без зала</span>}
                  </td>
                )}
                <td className="px-3 py-2 text-muted-foreground">
                  {personName(g.coach)}
                  {assistants > 0 && ` +${assistants}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{g.memberCount}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {week || `Нет ${vocabulary.session.genPl}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
