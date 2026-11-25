"use client"

import { MoreHorizontal } from "lucide-react"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@clubspace/ui-kit/ui"

import {
  createRankLevel,
  deleteRankLevel,
  listRankLadders,
  updateRankLevel,
  type RankLadder,
  type RankLadderList,
  type RankLevel,
} from "../../../../../shared/api/ranks"
import {
  listAdoptableLadderTemplates,
  type AdoptableTemplate,
} from "../../../../../shared/api/organizations"
import {
  FederationTemplates,
  templateUpdateNote,
} from "../../../../../features/org/FederationTemplates"
import { DirectionChip } from "../../../../../features/directions/DirectionChip"
import {
  ALL_DIRECTIONS,
  DirectionFilter,
  matchesDirectionFilter,
} from "../../../../../features/directions/DirectionFilter"
import { useDirectionScope } from "../../../../../shared/workspace/use-direction-scope"
import { useDirections } from "../../../../../features/directions/use-directions"
import { SectionTabs } from "../../../../../shared/workspace/section-tabs"
import { beltTabs } from "../sections"
import { LadderFormSheet } from "../../../../../features/ranks/LadderFormSheet"
import {
  describeLevelRule,
  LevelFormSheet,
} from "../../../../../features/ranks/LevelFormSheet"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { confirmDialog } from "../../../../../shared/ui/confirm-dialog"
import {
  nextLevelOrder,
  swapSteps,
} from "../../../../../shared/lib/rank-level-order"

export default function WorkspaceRanksPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  // A direction manager only gets their directions' ladders from the server;
  // the selectors keep new/moved ladders inside those directions too.
  const scope = useDirectionScope(workspaceId)

  const [ladders, setLadders] = useState<RankLadder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { directions } = useDirections(workspaceId)
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)
  const [ladderSheetOpen, setLadderSheetOpen] = useState(false)
  const [editingLadder, setEditingLadder] = useState<RankLadder | null>(null)
  // Standards of the federations the club is in (none for most clubs), and
  // the current versions of those the listed ladders were copied from.
  const [templates, setTemplates] = useState<AdoptableTemplate[]>([])
  const [sources, setSources] = useState<RankLadderList["templates"]>([])
  const visibleLadders = ladders.filter((l) =>
    matchesDirectionFilter(directionFilter, l.direction?.id),
  )

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const [res, standards] = await Promise.all([
        listRankLadders({ workspaceId, includeInactive: true }),
        listAdoptableLadderTemplates({ workspaceId }).catch(() => []),
      ])
      setLadders(res.data)
      setSources(res.templates)
      setTemplates(standards)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить лестницы"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const openLadderSheet = (ladder: RankLadder | null) => {
    setError(null)
    setEditingLadder(ladder)
    setLadderSheetOpen(true)
  }

  if (!workspaceId) return null

  return (
    // The tab row spans the page like on «Аттестации»; the ladders keep a reading width.
    <div className="space-y-6">
      <SectionTabs title="Пояса" tabs={beltTabs} />
      <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Лестницы рангов клуба (например, «Взрослые» и «Дети»). Ранг выдают по
          итогам аттестации или одному ученику в его карточке.
        </p>
        <Button type="button" onClick={() => openLadderSheet(null)}>
          Добавить лестницу
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {ladders.length > 0 && directions.length > 0 && (
        <div className="flex justify-end">
          <DirectionFilter
            directions={scope.filterOptions(directions)}
            value={directionFilter}
            onChange={setDirectionFilter}
            includeClubOnly={scope.isSportLead}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : ladders.length === 0 ? (
        <p className="text-sm text-muted-foreground">Лестниц пока нет.</p>
      ) : visibleLadders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Нет лестниц в выбранном направлении.
        </p>
      ) : (
        <div className="space-y-4">
          {visibleLadders.map((ladder) => (
            <LadderCard
              key={ladder.id}
              workspaceId={workspaceId}
              ladder={ladder}
              templateNote={templateUpdateNote(ladder, sources)}
              onEdit={() => openLadderSheet(ladder)}
              onReload={load}
              onError={setError}
            />
          ))}
        </div>
      )}
      </div>

      <FederationTemplates
        workspaceId={workspaceId}
        templates={templates}
        directions={directions}
        allowedDirectionIds={scope.allowedDirectionIds}
        defaultDirectionId={scope.defaultDirectionId}
        onAdopted={(ladder) => {
          void load()
          // The copy opens in the editor: rename it, move it, change levels.
          openLadderSheet(ladder)
        }}
      />

      <LadderFormSheet
        workspaceId={workspaceId}
        open={ladderSheetOpen}
        onOpenChange={setLadderSheetOpen}
        ladder={editingLadder}
        directions={directions}
        allowedDirectionIds={scope.allowedDirectionIds}
        defaultDirectionId={scope.defaultDirectionId}
        onSaved={() => void load()}
      />
    </div>
  )
}

function LadderCard({
  workspaceId,
  ladder,
  templateNote,
  onEdit,
  onReload,
  onError,
}: {
  workspaceId: string
  ladder: RankLadder
  // «Стандарт федерации обновлён до версии N» for an outdated copy.
  templateNote: string | null
  onEdit: () => void
  onReload: () => Promise<void>
  onError: (m: string) => void
}) {
  const vocabulary = useVocabulary()
  const [busy, setBusy] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<RankLevel | null>(null)

  const openSheet = (level: RankLevel | null) => {
    setEditing(level)
    setSheetOpen(true)
  }

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

  const removeLevel = async (lv: RankLevel) => {
    if (
      !(await confirmDialog({
        title: `Удалить уровень «${lv.name}»?`,
        description:
          "Уровень, который уже кому-то присваивали или который стоит в аттестации, удалить нельзя — отправьте его в архив.",
        destructive: true,
      }))
    )
      return
    await run(
      () => deleteRankLevel({ workspaceId, ladderId: ladder.id, levelId: lv.id }),
      "Не удалось удалить уровень",
    )
  }

  const toggleLevelActive = (lv: RankLevel) =>
    run(
      () =>
        updateRankLevel({
          workspaceId,
          ladderId: ladder.id,
          levelId: lv.id,
          data: { isActive: !lv.isActive },
        }),
      "Не удалось изменить уровень",
    )

  const moveLevel = (index: number, direction: -1 | 1) => {
    const steps = swapSteps(ladder.levels, index, direction)
    if (!steps) return
    void run(async () => {
      for (const step of steps) {
        await updateRankLevel({
          workspaceId,
          ladderId: ladder.id,
          levelId: step.levelId,
          data: { order: step.order },
        })
      }
    }, "Не удалось изменить порядок уровней")
  }

  // Index the edited level has (or a new one will have): the «допуск» is the
  // step up to a level, so the first level carries none.
  const editingIndex = editing
    ? ladder.levels.findIndex((l) => l.id === editing.id)
    : ladder.levels.length

  return (
    <div className="rounded-xl border border-border p-4">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2 text-left hover:opacity-80"
        onClick={onEdit}
      >
        <span className="font-medium">{ladder.name}</span>
        <DirectionChip direction={ladder.direction} />
        {ladder.audience && (
          <span className="text-xs text-muted-foreground">
            Для кого: {ladder.audience}
          </span>
        )}
        {!ladder.isActive && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            В архиве
          </span>
        )}
        {ladder.templateId && (
          <span className="text-xs text-muted-foreground">по стандарту федерации</span>
        )}
        {templateNote && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-500">
            {templateNote}
          </span>
        )}
      </button>

      {ladder.levels.length > 0 && (
        <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
          {ladder.levels.map((lv, i) => {
            const meta = [
              lv.maxStripes > 0
                ? `до ${lv.maxStripes} ${pluralRu(lv.maxStripes, "полоски", "полосок", "полосок")}`
                : null,
              i >= 1 ? describeLevelRule(lv, vocabulary) : null,
            ].filter(Boolean)
            return (
              <li
                key={lv.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
                  onClick={() => openSheet(lv)}
                >
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: lv.color ?? "transparent" }}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate">
                        {i + 1}. {lv.name}
                      </span>
                      {!lv.isActive && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          В архиве
                        </span>
                      )}
                    </span>
                    {meta.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {meta.join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Действия: ${lv.name}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={i === 0}
                      onSelect={() => moveLevel(i, -1)}
                    >
                      Выше
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={i === ladder.levels.length - 1}
                      onSelect={() => moveLevel(i, 1)}
                    >
                      Ниже
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void toggleLevelActive(lv)}>
                      {lv.isActive ? "В архив" : "Вернуть из архива"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => void removeLevel(lv)}
                    >
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
        onClick={() => openSheet(null)}
      >
        Добавить уровень
      </Button>

      <LevelFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        level={editing}
        save={(data, isCreate) =>
          isCreate || !editing
            ? createRankLevel({
                workspaceId,
                ladderId: ladder.id,
                data: { ...data, order: nextLevelOrder(ladder.levels) },
              })
            : updateRankLevel({ workspaceId, ladderId: ladder.id, levelId: editing.id, data })
        }
        withRule={editingIndex >= 1}
        onSaved={() => void onReload()}
      />
    </div>
  )
}
