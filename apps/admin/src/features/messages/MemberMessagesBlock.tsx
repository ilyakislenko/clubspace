"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { listClubMessages, type ClubMessagesPage } from "../../shared/api/messages"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { statusLabel } from "./message-view"

const SHOWN = 5

/**
 * The member card's «Сообщения»: the last messages this student got from the
 * club (as far as the viewer may see them), each opened or not. Renders
 * nothing until there is one; «Все» opens the list filtered to the student.
 */
export function MemberMessagesBlock({
  workspaceId,
  userId,
  // Bumped by the card after a message is sent from it.
  reloadKey,
}: {
  workspaceId: string
  userId: string
  reloadKey: number
}) {
  const [page, setPage] = useState<ClubMessagesPage | null>(null)

  const load = useCallback(async () => {
    try {
      setPage(await listClubMessages({ workspaceId, userId, perPage: SHOWN }))
    } catch {
      // A side block: the card stays as it was without it.
      setPage(null)
    }
  }, [workspaceId, userId])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useWorkspaceRealtime(workspaceId, ["messages"], () => void load())

  if (!page || page.total === 0) return null
  const now = new Date()

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">
          Сообщения <span className="text-muted-foreground">· {page.total}</span>
        </h2>
        {page.total > SHOWN && (
          <Link
            href={`/workspace/${workspaceId}/users/messages?userId=${userId}`}
            className="text-xs text-primary hover:underline"
          >
            Все
          </Link>
        )}
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border text-sm">
        {page.data.map((m) => (
          <li key={m.id}>
            <Link
              href={`/workspace/${workspaceId}/users/messages?userId=${userId}&message=${m.id}`}
              className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/50"
            >
              <span className="min-w-0 truncate">{m.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {statusLabel(m, page.timezone, now)}
                {m.status === "SENT" && (m.recipientReadAt ? " · открыто" : " · не открыто")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
