"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { updateRankLevel, type RankLevel } from "../../shared/api/ranks"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"

const describeRule = (lv: RankLevel): string => {
  const parts = [
    lv.minVisits != null ? `${lv.minVisits} трен.` : null,
    lv.minWeeks != null ? `${lv.minWeeks} нед.` : null,
  ].filter(Boolean)
  return parts.length > 0 ? `Допуск: ${parts.join(" · ")}` : "Допуск: не задан"
}

// «Допуск к аттестации» on the target level: minimum visits and weeks since
// the member's previous promotion. Empty = no requirement on that axis.
export function LevelRuleEditor({
  workspaceId,
  ladderId,
  level,
  onSaved,
}: {
  workspaceId: string
  ladderId: string
  level: RankLevel
  onSaved: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [visits, setVisits] = useState("")
  const [weeks, setWeeks] = useState("")
  const [error, setError] = useState<string | null>(null)

  const open = () => {
    setVisits(level.minVisits != null ? String(level.minVisits) : "")
    setWeeks(level.minWeeks != null ? String(level.minWeeks) : "")
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    const minVisits = visits.trim()
      ? parseIntInput(visits, { min: 1, max: 5000 })
      : null
    const minWeeks = weeks.trim()
      ? parseIntInput(weeks, { min: 1, max: 520 })
      : null
    if (visits.trim() && minVisits === null) {
      setError("Тренировки: целое число от 1 до 5000")
      return
    }
    if (weeks.trim() && minWeeks === null) {
      setError("Недели: целое число от 1 до 520")
      return
    }
    try {
      await updateRankLevel({
        workspaceId,
        ladderId,
        levelId: level.id,
        data: { minVisits, minWeeks },
      })
      setEditing(false)
      await onSaved()
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить допуск"))
    }
  }

  if (!editing) {
    return (
      <span className="flex w-full items-center gap-2 pl-5 text-xs text-muted-foreground">
        {describeRule(level)}
        <button className="hover:text-foreground" onClick={open}>
          Изменить
        </button>
      </span>
    )
  }

  return (
    <div className="w-full space-y-1 pl-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} w-36`}
          placeholder="Мин. тренировок"
          aria-label="Мин. тренировок"
          value={visits}
          onChange={(e) => setVisits(e.target.value)}
        />
        <input
          className={`${inputCls} w-32`}
          placeholder="Мин. недель"
          aria-label="Мин. недель"
          value={weeks}
          onChange={(e) => setWeeks(e.target.value)}
        />
        <Button size="sm" onClick={() => void save()}>
          Сохранить
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
          Отмена
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        с прошлого повышения; пусто — без правила
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
