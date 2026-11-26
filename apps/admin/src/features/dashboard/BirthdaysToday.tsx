"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import {
  listBirthdaysToday,
  type BirthdayMember,
} from "../../shared/api/birthdays"
import { pluralRu } from "../../shared/lib/plural-ru"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

/**
 * «Дни рождения сегодня» on «Сегодня»: the club's members (a coach's own
 * groups') with a birthday today, club-local. Not a decision — nothing waits
 * for one — so it renders nothing at all on a day without birthdays, and a
 * failed read hides it the same way. The age only for a child; a row opens
 * the member card.
 */
export function BirthdaysToday({ workspaceId }: { workspaceId: string }) {
  const [members, setMembers] = useState<BirthdayMember[]>([])

  const load = useCallback(async () => {
    try {
      setMembers((await listBirthdaysToday({ workspaceId })).members)
    } catch {
      // Best-effort, like the page's other extras: no block, no error line.
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  // A date of birth set or cleared in a member card or the app.
  useWorkspaceRealtime(workspaceId, ["members"], () => void load())

  if (members.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Дни рождения сегодня</h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {members.map((m) => (
          <li key={m.userId}>
            <Link
              href={`/workspace/${workspaceId}/users/${m.userId}`}
              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/60"
            >
              {m.photoUrl ? (
                <img src={m.photoUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
              ) : (
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
                >
                  {initialsOf(m.name)}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{m.name}</span>
                {m.turns !== null && (
                  <span>
                    {" "}
                    · исполняется {m.turns} {pluralRu(m.turns, "год", "года", "лет")}
                  </span>
                )}
                {m.groups.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {m.groups.map((g) => g.name).join(", ")}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
