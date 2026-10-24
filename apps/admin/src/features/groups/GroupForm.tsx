"use client"

import { useState, type FormEvent } from "react"

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

import { type Gym } from "../../shared/api/groups"
import { type WorkspaceMember } from "../../shared/api/members"
import { formatMemberLabel } from "./helpers"

export type GroupFormPayload = {
  name: string
  gymId: string
  coachId: string
  memberIds?: string[]
}

type Props = {
  mode: "create" | "edit"
  initial?: {
    name: string
    gymId: string
    coachId: string
    memberIds: string[]
  }
  gyms: Gym[]
  members: WorkspaceMember[]
  coachOptions: WorkspaceMember[]
  submitting: boolean
  onCancel: () => void
  onSubmit: (payload: GroupFormPayload) => Promise<void>
}

export function GroupForm({
  mode,
  initial,
  gyms,
  members,
  coachOptions,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "")
  const [gymId, setGymId] = useState(initial?.gymId ?? gyms[0]?.id ?? "")
  const [coachId, setCoachId] = useState(initial?.coachId ?? "")
  const [memberIds, setMemberIds] = useState<string[]>(initial?.memberIds ?? [])

  const toggleMember = (userId: string) => {
    setMemberIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    )
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !gymId || !coachId) return
    void onSubmit({
      name: name.trim(),
      gymId,
      coachId,
      memberIds,
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h3 className="text-sm font-medium">
        {mode === "create" ? "Новая группа" : "Редактирование группы"}
      </h3>

      <div>
        <Label htmlFor="group-name">Название</Label>
        <Input
          id="group-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Утренняя"
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Зал</Label>
          <Select value={gymId} onValueChange={setGymId}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите зал" />
            </SelectTrigger>
            <SelectContent>
              {gyms.map((gym) => (
                <SelectItem key={gym.id} value={gym.id}>
                  {gym.name} · {gym.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Тренер</Label>
          <Select
            value={coachId}
            onValueChange={(next) => {
              setCoachId(next)
              // The new coach can't simultaneously be a student of the
              // same group — drop them from the desired member list when
              // they get promoted.
              setMemberIds((prev) => prev.filter((id) => id !== next))
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Кто ведёт" />
            </SelectTrigger>
            <SelectContent>
              {coachOptions.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {formatMemberLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Расписание группы и отмены задаются ниже после сохранения карточки.
      </p>

      <div className="space-y-1.5">
        <Label>Ученики ({memberIds.length} выбрано)</Label>
        <div className="max-h-48 overflow-y-auto rounded-md border border-border">
          {members.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              В клубе пока нет учеников
            </p>
          ) : (
            members.map((m) => (
              <label
                key={m.userId}
                className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={memberIds.includes(m.userId)}
                  onChange={() => toggleMember(m.userId)}
                  disabled={m.userId === coachId}
                />
                <span className="flex-1 truncate">{formatMemberLabel(m)}</span>
                {m.userId === coachId && (
                  <span className="text-xs text-muted-foreground italic">
                    тренер
                  </span>
                )}
              </label>
            ))
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Отмена
        </Button>
        <Button
          type="submit"
          disabled={submitting || !name.trim() || !gymId || !coachId}
        >
          {submitting
            ? "Сохраняю…"
            : mode === "create"
              ? "Создать группу"
              : "Сохранить"}
        </Button>
      </div>
    </form>
  )
}
