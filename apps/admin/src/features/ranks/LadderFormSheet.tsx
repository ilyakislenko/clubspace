"use client"

import { useEffect, useState } from "react"

import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import type { Direction } from "../../shared/api/directions"
import {
  createRankLadder,
  deleteRankLadder,
  updateRankLadder,
  type RankLadder,
} from "../../shared/api/ranks"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { confirmLeave, sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { pluralRu } from "../../shared/lib/plural-ru"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { DirectionSelect } from "../directions/DirectionSelect"

type Props = {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // null = create mode.
  ladder: RankLadder | null
  directions: Direction[]
  // Direction manager: only their directions (`useDirectionScope`).
  allowedDirectionIds: readonly string[] | undefined
  // Direction of a new ladder before the person picks one.
  defaultDirectionId: string | null
  onSaved: () => void
}

export function LadderFormSheet({
  workspaceId,
  open,
  onOpenChange,
  ladder,
  directions,
  allowedDirectionIds,
  defaultDirectionId,
  onSaved,
}: Props) {
  const isCreate = !ladder
  const [name, setName] = useState("")
  const [audience, setAudience] = useState("")
  const [directionId, setDirectionId] = useState<string | null>(null)
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  // Re-initialise every time the sheet opens, from the edited ladder or blank.
  useEffect(() => {
    if (!open) return
    setName(ladder?.name ?? "")
    setAudience(ladder?.audience ?? "")
    setDirectionId(ladder ? (ladder.direction?.id ?? null) : defaultDirectionId)
    setIsActive(ladder?.isActive ?? true)
    setError("")
  }, [open, ladder, defaultDirectionId])

  // Closing with changes asks first (the same prompt as leaving the page).
  const saved = {
    name: ladder?.name ?? "",
    audience: ladder?.audience ?? "",
    directionId: ladder ? (ladder.direction?.id ?? null) : defaultDirectionId,
    isActive: ladder?.isActive ?? true,
  }
  const dirty = open && !sameData({ name, audience, directionId, isActive }, saved)
  useDirtyGuard(dirty)
  const requestClose = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError("")
    const data = {
      name: name.trim(),
      audience: audience.trim() || null,
      directionId,
    }
    try {
      if (ladder) {
        await updateRankLadder({
          workspaceId,
          ladderId: ladder.id,
          data: { ...data, isActive },
        })
      } else {
        await createRankLadder({ workspaceId, data })
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить лестницу"))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!ladder) return
    const levels = ladder.levels.length
    if (
      !(await confirmDialog({
        title: `Удалить лестницу «${ladder.name}»?`,
        description: `${
          levels > 0
            ? `Вместе с ней удалятся ${levels} ${pluralRu(levels, "уровень", "уровня", "уровней")}. `
            : ""
        }Лестницу, по которой уже присваивали ранги или проводили аттестации, удалить нельзя — снимите отметку «Активна», чтобы убрать её в архив.`,
        destructive: true,
      }))
    )
      return
    setSaving(true)
    setError("")
    try {
      await deleteRankLadder({ workspaceId, ladderId: ladder.id })
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err, "Не удалось удалить лестницу"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{isCreate ? "Новая лестница" : "Редактировать лестницу"}</SheetTitle>
          <SheetDescription>
            Лестница — порядок рангов, например пояса взрослых или детские
            уровни.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="ladder-name">Название</Label>
            <Input
              id="ladder-name"
              value={name}
              maxLength={FORM_LIMITS.ladder.name.max}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Взрослые"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ladder-audience">Для кого (необязательно)</Label>
            <Input
              id="ladder-audience"
              value={audience}
              maxLength={FORM_LIMITS.ladder.audience.max}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Например: взрослые или дети 5–13 лет"
            />
          </div>

          <DirectionSelect
            id="ladder-direction"
            directions={directions}
            value={directionId}
            onChange={setDirectionId}
            allowedIds={allowedDirectionIds}
          />

          {!isCreate && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Активна
              <span className="text-xs text-muted-foreground">
                (по архивной лестнице не назначают аттестации)
              </span>
            </label>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <SheetFooter>
          <div className="flex w-full items-center gap-2">
            {!isCreate && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={() => void handleDelete()}
                disabled={saving}
              >
                Удалить
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void requestClose()}
                disabled={saving}
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving || !name.trim()}
              >
                {saving ? "Сохраняем…" : isCreate ? "Создать лестницу" : "Сохранить"}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
