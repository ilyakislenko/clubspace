"use client"

import { useEffect, useMemo, useState } from "react"

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TimePicker,
} from "@clubspace/ui-kit/ui"

import {
  createGroupSlot,
  type GroupScheduleSlot,
  type GroupSummary,
} from "../../../shared/api/groups"
import { errorMessage } from "../../../shared/lib/error-message"
import { DirectionDot } from "../../directions/DirectionChip"
import { personName } from "./calendar-format"
import {
  dayLabel,
  DOW_SHORT,
  formatHm,
  isoDow,
  minutesOf,
  type Conflict,
} from "./calendar-helpers"
import type { CalendarItem } from "./calendar-items"
import { ConflictList } from "./ConflictList"
import { groupOptionLabel } from "../../../shared/lib/group-label"
import { useVocabulary } from "../../../shared/lib/vocabulary"
import { cap } from "@clubspace/ui-kit/brand"

const DURATIONS = [45, 60, 75, 90, 120]

// `gymId` set: the cell sits in a hall column, so only that hall's groups are offered.
export type CreateSlotRequest = { date: string; startMin: number; gymId?: string | null }

type Props = {
  workspaceId: string
  request: CreateSlotRequest | null
  // Groups the viewer may schedule.
  groups: GroupSummary[]
  conflictsFor: (p: {
    date: string
    startMin: number
    endMin: number
    group: GroupSummary
  }) => Conflict<CalendarItem>[]
  onClose: () => void
  onCreated: (slot: GroupScheduleSlot, group: GroupSummary) => void
}

/** Click on an empty cell: a class for one of the groups, once or weekly. */
export function CreateSlotDialog({
  workspaceId,
  request,
  groups,
  conflictsFor,
  onClose,
  onCreated,
}: Props) {
  const vocabulary = useVocabulary()
  const [groupId, setGroupId] = useState("")
  const [time, setTime] = useState("19:00")
  const [duration, setDuration] = useState("60")
  const [weekly, setWeekly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!request) return
    setTime(formatHm(request.startMin))
    setError(null)
    setWeekly(false)
    setDuration("60")
    setGroupId((g) => (groups.some((x) => x.id === g) ? g : (groups[0]?.id ?? "")))
  }, [request, groups])

  const group = groups.find((g) => g.id === groupId)
  const durationMin = Number(duration)
  const startMin = minutesOf(time || "00:00")
  const validDuration = Number.isInteger(durationMin) && durationMin >= 5 && startMin + durationMin <= 24 * 60
  const conflicts = useMemo(
    () =>
      request && group && validDuration
        ? conflictsFor({ date: request.date, startMin, endMin: startMin + durationMin, group })
        : [],
    [request, group, validDuration, startMin, durationMin, conflictsFor],
  )

  if (!request) return null

  const submit = async () => {
    if (!group || !validDuration) return
    setBusy(true)
    setError(null)
    try {
      const slot = await createGroupSlot({
        workspaceId,
        groupId: group.id,
        data: {
          dayOfWeek: isoDow(request.date),
          startTime: time,
          durationMin,
          effectiveFrom: request.date,
          effectiveUntil: weekly ? null : request.date,
        },
      })
      onCreated(slot, group)
    } catch (e) {
      setError(errorMessage(e, "Не удалось добавить занятие"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-lg" data-calendar-create-dialog>
        <DialogHeader>
          <DialogTitle>Новое занятие</DialogTitle>
          <DialogDescription className="first-letter:uppercase">{dayLabel(request.date)}</DialogDescription>
        </DialogHeader>

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет групп, в расписание которых вы можете добавлять занятия.
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="create-slot-group">Группа</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger id="create-slot-group">
                  <SelectValue placeholder="Выберите группу" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      <span className="inline-flex items-center gap-2">
                        <DirectionDot color={g.direction?.color ?? null} />
                        {groupOptionLabel(g)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {group && (
                <p className="text-xs text-muted-foreground">
                  Зал: {group.gym?.name ?? "не указан"} · {cap(vocabulary.coach.nom)}: {personName(group.coach)} — как в
                  настройках группы.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Начало</Label>
                <TimePicker value={time} onChange={setTime} minuteStep={15} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="create-slot-duration">Длительность, мин</Label>
                <Input
                  id="create-slot-duration"
                  inputMode="numeric"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))}
                  list="create-slot-durations"
                />
                <datalist id="create-slot-durations">
                  {DURATIONS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
            </div>

            <fieldset className="grid gap-2 text-sm">
              <legend className="mb-1 text-sm font-medium">Повтор</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="create-slot-repeat"
                  className="accent-primary"
                  checked={!weekly}
                  onChange={() => setWeekly(false)}
                />
                Только в этот день
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="create-slot-repeat"
                  className="accent-primary"
                  checked={weekly}
                  onChange={() => setWeekly(true)}
                />
                Каждую неделю по {DOW_SHORT[isoDow(request.date)].toLowerCase()}, начиная с этой даты
              </label>
            </fieldset>

            <ConflictList conflicts={conflicts} />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!validDuration && (
          <p className="text-sm text-destructive">Занятие должно закончиться до полуночи.</p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !group || !validDuration}>
            {busy ? "Сохраняем…" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
