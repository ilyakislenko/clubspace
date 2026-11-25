"use client"

import { useEffect, useState, type FormEvent } from "react"

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import { listGroups, type GroupSummary } from "../../shared/api/groups"
import type { Lead, SetLeadStatusInput } from "../../shared/api/leads"
import { groupOptionLabel } from "../../shared/lib/group-label"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { wallClockIn } from "./lead-view"

const NO_GROUP = "none"

type BookData = Pick<SetLeadStatusInput, "trialAt" | "trialGroupId" | "notifyCoach">

const coachName = (group: GroupSummary): string | null => {
  const name = [group.coach.firstname, group.coach.lastname].filter(Boolean).join(" ")
  return name || group.coach.email
}

// «Записать на пробное» and «Перенести»: the day and time as a wall clock (the
// server reads it in the group's gym zone, else the club's; «Перенести» starts
// from the booked time in `trialTimezone`), an optional group (the lead's
// direction first) and whether its coach hears about it — on once a group is
// picked (name and time only, never the phone).
export function LeadBookForm({
  workspaceId,
  lead,
  busy,
  error,
  onDirty,
  onCancel,
  onSubmit,
}: {
  workspaceId: string
  lead: Lead
  busy: boolean
  error: string | null
  onDirty: (dirty: boolean) => void
  onCancel: () => void
  onSubmit: (data: BookData) => void
}) {
  const vocabulary = useVocabulary()
  const [initialDate, initialTime] = lead.trialAt ? wallClockIn(lead.trialAt, lead.trialTimezone) : ["", ""]
  const [date, setDate] = useState(initialDate)
  const [time, setTime] = useState(initialTime)
  const [groupId, setGroupId] = useState(lead.trialGroupId ?? NO_GROUP)
  const [notify, setNotify] = useState(lead.trialGroupId !== null)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    listGroups({ workspaceId, directionId: lead.directionId ?? undefined })
      .then((res) => setGroups(res.data))
      // The group is optional: a failed list leaves «Без группы».
      .catch(() => setGroups([]))
  }, [workspaceId, lead.directionId])

  const change = (next: { date?: string; time?: string; groupId?: string }) => {
    const d = next.date ?? date
    const t = next.time ?? time
    const g = next.groupId ?? groupId
    onDirty(d !== initialDate || t !== initialTime || g !== (lead.trialGroupId ?? NO_GROUP))
  }

  const today = wallClockIn(new Date().toISOString(), lead.timezone)[0]
  const group = groups.find((g) => g.id === groupId)
  const coach = group ? coachName(group) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!date || !time) return
    onSubmit({
      trialAt: `${date}T${time}`,
      trialGroupId: groupId === NO_GROUP ? null : groupId,
      notifyCoach: groupId !== NO_GROUP && notify,
    })
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <h3 className="text-sm font-semibold">{lead.status === "TRIAL_BOOKED" ? "Перенести пробное" : "Записать на пробное"}</h3>
      <div className="flex flex-wrap gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="trial-date">Дата</Label>
          <Input
            id="trial-date"
            type="date"
            min={today}
            value={date}
            disabled={busy}
            className="w-[160px]"
            onChange={(e) => {
              setDate(e.target.value)
              change({ date: e.target.value })
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="trial-time">Время</Label>
          <Input
            id="trial-time"
            type="time"
            step={300}
            value={time}
            disabled={busy}
            className="w-[120px]"
            onChange={(e) => {
              setTime(e.target.value)
              change({ time: e.target.value })
            }}
          />
        </div>
      </div>
      {touched && (!date || !time) && <p className="text-xs text-destructive">Укажите дату и время</p>}

      <div className="space-y-1.5">
        <Label>Группа</Label>
        <Select
          value={groupId}
          onValueChange={(v) => {
            setGroupId(v)
            setNotify(v !== NO_GROUP)
            change({ groupId: v })
          }}
        >
          <SelectTrigger disabled={busy}>
            <SelectValue>{group ? groupOptionLabel(group) : "Без группы"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_GROUP}>Без группы</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {groupOptionLabel(g)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {group && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} disabled={busy} onChange={(e) => setNotify(e.target.checked)} />
          Предупредить {coach ?? vocabulary.coach.acc}
        </label>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Записываем…" : "Записать"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  )
}
