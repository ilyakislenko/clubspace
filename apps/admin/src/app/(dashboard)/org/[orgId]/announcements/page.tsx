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

import {
  deleteOrgAnnouncement,
  listOrgAnnouncements,
  updateOrgAnnouncement,
  type OrgAnnouncement,
} from "../../../../../shared/api/organizations"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { confirmDialog } from "../../../../../shared/ui/confirm-dialog"
import { useOrg } from "../../../../../features/org/org-context"
import { OrgAnnouncementFormSheet, orgPublishText } from "../../../../../features/org/OrgAnnouncementFormSheet"
import { audienceLabel } from "../../../../../features/org/org-view"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"

const publishState = (a: OrgAnnouncement): { label: string; tone: string } => {
  if (!a.publishedAt) return { label: "Черновик", tone: "bg-muted text-muted-foreground" }
  const at = new Date(a.publishedAt)
  if (at > new Date()) {
    return {
      label: `Запланировано · ${at.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      tone: "bg-amber-500/10 text-amber-600",
    }
  }
  return { label: "Опубликовано", tone: "bg-emerald-500/10 text-emerald-600" }
}

// «Объявления»: the federation's channel to the member clubs' staff and, by
// choice, their members' feeds. Admins write; org coaches read.
export default function OrgAnnouncementsPage() {
  const vocabulary = useVocabulary()
  const { org, isAdmin } = useOrg()
  const [items, setItems] = useState<OrgAnnouncement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<OrgAnnouncement | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await listOrgAnnouncements({ organizationId: org.id })
      setItems(res.data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить объявления"))
    } finally {
      setLoading(false)
    }
  }, [org.id])

  useEffect(() => {
    void load()
  }, [load])

  const openSheet = (a: OrgAnnouncement | null) => {
    setEditing(a)
    setSheetOpen(true)
  }

  const run = async (a: OrgAnnouncement, action: () => Promise<unknown>) => {
    setBusyId(a.id)
    try {
      await action()
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось изменить объявление"))
    } finally {
      setBusyId(null)
    }
  }

  const togglePublish = async (a: OrgAnnouncement) => {
    if (
      !a.publishedAt &&
      !(await confirmDialog({
        title: `Опубликовать «${a.title}»?`,
        description: orgPublishText(a.audience),
        confirmLabel: "Опубликовать",
      }))
    )
      return
    await run(a, () =>
      updateOrgAnnouncement({
        organizationId: org.id,
        announcementId: a.id,
        data: { publish: !a.publishedAt },
      }),
    )
  }

  const remove = async (a: OrgAnnouncement) => {
    if (
      !(await confirmDialog({
        title: `Удалить объявление «${a.title}»?`,
        description: a.publishedAt ? "Клубы и ученики больше не увидят его." : undefined,
        destructive: true,
      }))
    )
      return
    await run(a, () => deleteOrgAnnouncement({ organizationId: org.id, announcementId: a.id }))
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">Объявления</h1>
        {isAdmin && (
          <Button type="button" onClick={() => openSheet(null)}>
            Новое объявление
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Объявлений пока нет.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const state = publishState(a)
            const content = (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.title}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${state.tone}`}>{state.label}</span>
                </span>
                <span className="mt-1 line-clamp-3 block whitespace-pre-wrap text-sm text-muted-foreground">
                  {a.body}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {audienceLabel(a.audience, vocabulary)} · {a.authorName}
                </span>
              </>
            )
            return (
              <li key={a.id} className="flex items-start gap-3 rounded-xl border border-border p-4">
                {isAdmin ? (
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left hover:opacity-80"
                    onClick={() => openSheet(a)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="min-w-0 flex-1">{content}</div>
                )}
                {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busyId === a.id}
                        aria-label={`Действия: ${a.title}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void togglePublish(a)}>
                        {a.publishedAt ? "В черновик" : "Опубликовать"}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => void remove(a)}>
                        Удалить
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {isAdmin && (
        <OrgAnnouncementFormSheet
          organizationId={org.id}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          announcement={editing}
          onSaved={() => void load()}
        />
      )}
    </div>
  )
}
