"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  listWorkspaceInvitations,
  revokeWorkspaceInvitation,
  type WorkspaceInvitation,
} from "../../shared/api/invitations"
import { errorMessage } from "../../shared/lib/error-message"
import { formatRoleName } from "../../shared/lib/role-labels"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { confirmDialog } from "../../shared/ui/confirm-dialog"

// «Ожидают принятия»: people with an existing account the club invited. They
// join only after accepting in the app (an existing account is never enrolled
// without consent). `refreshKey` lets the page reload the list after it sends
// an invite or runs an import; realtime covers accept/decline from the app.
export function PendingInvitationsPanel({
  workspaceId,
  refreshKey,
}: {
  workspaceId: string
  refreshKey: number
}) {
  const vocabulary = useVocabulary()
  const [items, setItems] = useState<WorkspaceInvitation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await listWorkspaceInvitations({ workspaceId })
      setItems(res.data)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить приглашения."))
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useWorkspaceRealtime(workspaceId, ["members"], () => void load())

  const handleRevoke = async (item: WorkspaceInvitation) => {
    const ok = await confirmDialog({
      title: `Отозвать приглашение для ${item.email}?`,
      description:
        "Приглашение в приложении перестанет действовать. Пригласить снова можно в любой момент.",
      confirmLabel: "Отозвать",
      destructive: true,
    })
    if (!ok) return
    setRevokingId(item.id)
    setError(null)
    try {
      await revokeWorkspaceInvitation({ workspaceId, invitationId: item.id })
      setItems((prev) => prev.filter((i) => i.id !== item.id))
    } catch (err) {
      setError(errorMessage(err, "Не удалось отозвать приглашение."))
    } finally {
      setRevokingId(null)
    }
  }

  if (items.length === 0 && !error) return null

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          Ожидают принятия ({items.length})
        </h3>
        <p className="text-xs text-muted-foreground">
          У этих людей уже есть аккаунт: они вступят в клуб, когда примут
          приглашение в приложении.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-2 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.email}</p>
              <p className="text-xs text-muted-foreground">
                {formatRoleName(item.roleName, vocabulary)} · ожидает принятия с{" "}
                {new Date(item.invitedAt).toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "long",
                })}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleRevoke(item)}
              disabled={revokingId === item.id}
            >
              {revokingId === item.id ? "Отзываем..." : "Отозвать"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
