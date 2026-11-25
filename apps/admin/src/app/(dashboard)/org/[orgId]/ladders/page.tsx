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
  createOrgTemplateLevel,
  deleteOrgTemplateLevel,
  listOrgLadderTemplates,
  updateOrgTemplateLevel,
  type OrgLadderTemplate,
  type OrgTemplateLevel,
} from "../../../../../shared/api/organizations"
import { FORM_LIMITS } from "../../../../../shared/lib/contract-limits"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { nextLevelOrder, swapSteps } from "../../../../../shared/lib/rank-level-order"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { confirmDialog } from "../../../../../shared/ui/confirm-dialog"
import { describeLevelRule, LevelFormSheet } from "../../../../../features/ranks/LevelFormSheet"
import { BeltDot } from "../../../../../features/org/BeltDot"
import { useOrg } from "../../../../../features/org/org-context"
import { OrgTemplateSheet } from "../../../../../features/org/OrgTemplateSheet"
import { adoptedText, stripesText } from "../../../../../features/org/org-view"

// «Стандарты»: ladders the member clubs adopt as an editable copy. The
// version grows with every level change; clubs see they are behind.
export default function OrgLaddersPage() {
  const { org } = useOrg()
  const [templates, setTemplates] = useState<OrgLadderTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<OrgLadderTemplate | null>(null)

  const load = useCallback(async () => {
    try {
      setTemplates((await listOrgLadderTemplates({ organizationId: org.id, includeInactive: true })).data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить стандарты"))
    }
  }, [org.id])

  useEffect(() => {
    void load()
  }, [load])

  const openSheet = (t: OrgLadderTemplate | null) => {
    setEditing(t)
    setSheetOpen(true)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">Стандарты</h1>
        <Button type="button" onClick={() => openSheet(null)}>
          Добавить стандарт
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {templates === null ? (
        !error && <div className="h-40 animate-pulse rounded-xl border border-border bg-muted" />
      ) : templates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Стандартов пока нет. Стандарт — образец лестницы поясов, который клубы берут за основу.
        </p>
      ) : (
        <div className="space-y-4">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              organizationId={org.id}
              template={t}
              onEdit={() => openSheet(t)}
              onReload={load}
              onError={setError}
            />
          ))}
        </div>
      )}

      <OrgTemplateSheet
        organizationId={org.id}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        template={editing}
        onSaved={() => void load()}
      />
    </div>
  )
}

function TemplateCard({
  organizationId,
  template,
  onEdit,
  onReload,
  onError,
}: {
  organizationId: string
  template: OrgLadderTemplate
  onEdit: () => void
  onReload: () => Promise<void>
  onError: (text: string) => void
}) {
  const vocabulary = useVocabulary()
  const [busy, setBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<OrgTemplateLevel | null>(null)
  const ids = { organizationId, templateId: template.id }
  const adopted = adoptedText(template.adoptions)

  const run = async (action: () => Promise<unknown>, failText: string) => {
    setBusy(true)
    try {
      await action()
    } catch (e) {
      onError(errorMessage(e, failText))
    }
    await onReload()
    setBusy(false)
  }

  const move = (index: number, direction: -1 | 1) => {
    const steps = swapSteps(template.levels, index, direction)
    if (!steps) return
    void run(async () => {
      for (const step of steps) {
        await updateOrgTemplateLevel({ ...ids, levelId: step.levelId, data: { order: step.order } })
      }
    }, "Не удалось изменить порядок уровней")
  }

  const remove = async (lv: OrgTemplateLevel) => {
    const ok = await confirmDialog({
      title: `Удалить уровень «${lv.name}»?`,
      description: "В лестницах клубов, взятых за основу, уровень останется.",
      destructive: true,
    })
    if (ok) await run(() => deleteOrgTemplateLevel({ ...ids, levelId: lv.id }), "Не удалось удалить уровень")
  }

  const editingIndex = editing ? template.levels.findIndex((l) => l.id === editing.id) : template.levels.length

  return (
    <div className="rounded-xl border border-border p-4">
      <button type="button" className="block w-full text-left hover:opacity-80" onClick={onEdit}>
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{template.name}</span>
          <span className="text-xs text-muted-foreground">версия {template.version}</span>
          {!template.isActive && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Не предлагается клубам</span>
          )}
        </span>
        {(template.audience || adopted) && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {[template.audience ? `Для кого: ${template.audience}` : null, adopted].filter(Boolean).join(" · ")}
          </span>
        )}
      </button>

      {template.levels.length > 0 && (
        <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
          {template.levels.map((lv, i) => {
            const meta = [
              lv.maxStripes > 0 ? `до ${stripesText(lv.maxStripes)}` : null,
              i >= 1 ? describeLevelRule(lv, vocabulary) : null,
            ].filter(Boolean)
            return (
              <li key={lv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
                  onClick={() => {
                    setEditing(lv)
                    setSheetOpen(true)
                  }}
                >
                  <BeltDot color={lv.color} />
                  <span className="min-w-0">
                    <span className="block truncate">
                      {i + 1}. {lv.name}
                    </span>
                    {meta.length > 0 && <span className="block text-xs text-muted-foreground">{meta.join(" · ")}</span>}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Действия: ${lv.name}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={i === 0} onSelect={() => move(i, -1)}>
                      Выше
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={i === template.levels.length - 1} onSelect={() => move(i, 1)}>
                      Ниже
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onSelect={() => void remove(lv)}>
                      Удалить
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )
          })}
        </ol>
      )}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="mt-2"
        onClick={() => {
          setEditing(null)
          setSheetOpen(true)
        }}
      >
        Добавить уровень
      </Button>

      <LevelFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        level={editing}
        limits={FORM_LIMITS.templateLevel}
        save={(data, isCreate) =>
          isCreate || !editing
            ? createOrgTemplateLevel({ ...ids, data: { ...data, order: nextLevelOrder(template.levels) } })
            : updateOrgTemplateLevel({ ...ids, levelId: editing.id, data })
        }
        withRule={editingIndex >= 1}
        onSaved={() => void onReload()}
      />
    </div>
  )
}
