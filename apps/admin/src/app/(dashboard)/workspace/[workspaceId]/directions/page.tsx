"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  deleteDirection,
  listDirections,
  updateDirection,
  type Direction,
} from "../../../../../shared/api/directions"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"
import { DirectionDot } from "../../../../../features/directions/DirectionChip"
import { DirectionFormSheet } from "../../../../../features/directions/DirectionFormSheet"

export default function DirectionsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [directions, setDirections] = useState<Direction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Direction | null>(null)

  const refresh = async () => {
    if (!workspaceId) return
    try {
      const res = await listDirections({ workspaceId })
      setDirections(res.data)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить направления"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useWorkspaceRealtime(workspaceId, ["directions", "groups"], () => void refresh())

  const nextOrder =
    directions.reduce((max, d) => Math.max(max, d.order), -1) + 1

  const openCreate = () => {
    setError(null)
    setEditing(null)
    setSheetOpen(true)
  }

  const openEdit = (d: Direction) => {
    setError(null)
    setEditing(d)
    setSheetOpen(true)
  }

  const toggleArchive = async (d: Direction) => {
    if (!workspaceId) return
    setBusyId(d.id)
    setError(null)
    try {
      await updateDirection({
        workspaceId,
        directionId: d.id,
        data: { isActive: !d.isActive },
      })
      await refresh()
    } catch (err) {
      setError(errorMessage(err, "Не удалось изменить направление"))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (d: Direction) => {
    if (!workspaceId) return
    if (!window.confirm(`Удалить направление «${d.name}»?`)) return
    setBusyId(d.id)
    setError(null)
    try {
      await deleteDirection({ workspaceId, directionId: d.id })
      await refresh()
    } catch (err) {
      // The server refuses (400) while the direction is in use and suggests
      // archiving instead — show its message verbatim.
      setError(errorMessage(err, "Не удалось удалить направление"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Направления</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Дисциплины внутри клуба — например, БЖЖ, ММА, тайский бокс. Группы,
            лестницы рангов, достижения, тарифы, события и объявления можно
            привязать к направлению. Пока направлений нет, всё работает на весь
            клуб.
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          + Новое направление
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-border bg-muted"
            />
          ))}
        </div>
      ) : directions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Направлений пока нет.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {directions.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <DirectionDot color={d.color} className="size-3" />
                <span className="w-7 shrink-0 text-center text-xl">
                  {d.icon ?? ""}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {d.name}
                    </span>
                    {!d.isActive && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        В архиве
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {d.groupCount}{" "}
                    {pluralRu(d.groupCount, "группа", "группы", "групп")}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busyId === d.id}
                  onClick={() => openEdit(d)}
                >
                  Изменить
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyId === d.id}
                  onClick={() => void toggleArchive(d)}
                >
                  {d.isActive ? "В архив" : "Вернуть"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busyId === d.id}
                  onClick={() => void handleDelete(d)}
                >
                  {busyId === d.id ? "..." : "Удалить"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {workspaceId && (
        <DirectionFormSheet
          workspaceId={workspaceId}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          direction={editing}
          nextOrder={nextOrder}
          onSaved={() => void refresh()}
        />
      )}
    </div>
  )
}
