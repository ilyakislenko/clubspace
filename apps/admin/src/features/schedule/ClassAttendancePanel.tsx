"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  createAttendanceSession,
  getSessionRoster,
  markAttendance,
  unmarkAttendance,
  type SessionRoster,
} from "../../shared/api/attendance"
import { errorMessage } from "../../shared/lib/error-message"

/**
 * «Отметить посещаемость» of one class from the admin: opens (or reuses) the
 * class's attendance session and toggles who was there. Head coaches, admins
 * and the owner mark any class; a coach — their groups' and the classes they
 * substitute in (the server answers otherwise).
 */
export function ClassAttendancePanel({
  workspaceId,
  slotId,
  sessionDate,
}: {
  workspaceId: string
  slotId: string
  sessionDate: string
}) {
  const [roster, setRoster] = useState<SessionRoster | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (
    action: () => Promise<SessionRoster>,
    failure: string,
  ) => {
    setBusy(true)
    setError(null)
    try {
      setRoster(await action())
    } catch (err) {
      setError(errorMessage(err, failure))
    } finally {
      setBusy(false)
    }
  }

  const open = () =>
    void run(async () => {
      const session = await createAttendanceSession({
        workspaceId,
        data: { kind: "scheduled", slotId, sessionDate },
      })
      return getSessionRoster({ workspaceId, sessionId: session.id })
    }, "Не удалось открыть посещаемость")

  const toggle = (userId: string, present: boolean) => {
    if (!roster) return
    const sessionId = roster.sessionId
    void run(
      () =>
        present
          ? unmarkAttendance({ workspaceId, sessionId, userId })
          : markAttendance({ workspaceId, sessionId, userIds: [userId] }),
      "Не удалось изменить отметку",
    )
  }

  const rows = roster
    ? [
        ...roster.roster.map((r) => ({
          userId: r.userId,
          name: r.displayName,
          present: r.present,
          guest: !!r.isGuest,
        })),
        ...roster.expected
          .filter((e) => !roster.roster.some((r) => r.userId === e.userId))
          .map((e) => ({
            userId: e.userId,
            name: e.displayName,
            present: e.present,
            guest: true,
          })),
      ]
    : []

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase text-muted-foreground">
          Посещаемость
        </div>
        {roster && (
          <span className="text-xs text-muted-foreground">
            Пришли: {rows.filter((r) => r.present).length}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!roster ? (
        <Button type="button" size="sm" disabled={busy} onClick={open}>
          {busy ? "..." : "Отметить посещаемость"}
        </Button>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">В группе пока никого нет.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <li
              key={r.userId}
              className="flex items-center gap-2 px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {r.name}
                {r.guest && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    гость
                  </span>
                )}
              </span>
              <Button
                type="button"
                size="sm"
                variant={r.present ? "default" : "outline"}
                disabled={busy}
                onClick={() => toggle(r.userId, r.present)}
              >
                {r.present ? "Был" : "Отметить"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
