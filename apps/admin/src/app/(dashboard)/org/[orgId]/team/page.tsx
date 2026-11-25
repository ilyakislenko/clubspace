"use client"

import { MoreHorizontal } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@clubspace/ui-kit/ui"

import { listOrgMembers, removeOrgMember, type OrgMember } from "../../../../../shared/api/organizations"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { confirmDialog } from "../../../../../shared/ui/confirm-dialog"
import { useOrg } from "../../../../../features/org/org-context"
import { OrgMemberSheet } from "../../../../../features/org/OrgMemberSheet"
import { orgRoleLabel } from "../../../../../features/org/org-view"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"

// «Команда»: the federation's staff. They never become club members; what
// they see of a club is what the club shares.
export default function OrgTeamPage() {
  const { org } = useOrg()
  const vocabulary = useVocabulary()
  const [members, setMembers] = useState<OrgMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<OrgMember | null>(null)

  const load = useCallback(async () => {
    try {
      setMembers((await listOrgMembers({ organizationId: org.id })).data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить команду"))
    }
  }, [org.id])

  useEffect(() => {
    void load()
  }, [load])

  const openSheet = (m: OrgMember | null) => {
    setEditing(m)
    setSheetOpen(true)
  }

  const remove = async (m: OrgMember) => {
    const who = m.name ?? m.email ?? "участника"
    const ok = await confirmDialog({
      title: `Убрать ${who} из команды?`,
      description: "Доступ к кабинету федерации закроется сразу.",
      confirmLabel: "Убрать",
      destructive: true,
    })
    if (!ok) return
    setBusyId(m.userId)
    try {
      await removeOrgMember({ organizationId: org.id, userId: m.userId })
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось убрать из команды"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">Команда</h1>
        <Button type="button" onClick={() => openSheet(null)}>
          Добавить
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {members === null ? (
        !error && <div className="h-24 animate-pulse rounded-xl border border-border bg-muted" />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2 pr-2">
              <button
                type="button"
                className="min-w-0 flex-1 px-4 py-3 text-left hover:bg-muted/40"
                onClick={() => openSheet(m)}
              >
                <span className="block truncate font-medium">{m.name ?? m.email}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {orgRoleLabel(m.role, vocabulary)}
                  {m.name && m.email ? ` · ${m.email}` : ""}
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busyId === m.userId}
                    aria-label={`Действия: ${m.name ?? m.email ?? ""}`}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive" onSelect={() => void remove(m)}>
                    Убрать
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <OrgMemberSheet
        organizationId={org.id}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        member={editing}
        onSaved={() => void load()}
      />
    </div>
  )
}
