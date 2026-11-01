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

import { type Direction } from "../../shared/api/directions"
import {
  type Gym,
  type GroupBookingMode,
} from "../../shared/api/groups"
import { type WorkspaceMember } from "../../shared/api/members"
import { DirectionSelect } from "../directions/DirectionSelect"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { formatMemberLabel, matchesMemberQuery } from "./helpers"

export type GroupFormPayload = {
  name: string
  gymId: string
  coachId: string
  directionId?: string | null
  memberIds?: string[]
  bookingMode: GroupBookingMode
  // null = unlimited places / the club's booking settings.
  capacity: number | null
  bookingWindowDays: number | null
  bookingCancelHours: number | null
}

// Empty = null (unlimited / club default); anything else must parse in range.
const parseOptionalInt = (
  raw: string,
  range: { min: number; max: number },
): { ok: true; value: number | null } | { ok: false } => {
  if (!raw.trim()) return { ok: true, value: null }
  const n = parseIntInput(raw, range)
  return n === null ? { ok: false } : { ok: true, value: n }
}

const intToInput = (n: number | null | undefined): string =>
  n == null ? "" : String(n)

type Props = {
  mode: "create" | "edit"
  initial?: {
    name: string
    gymId: string
    coachId: string
    directionId: string | null
    memberIds: string[]
    bookingMode: GroupBookingMode
    capacity: number | null
    bookingWindowDays: number | null
    bookingCancelHours: number | null
  }
  gyms: Gym[]
  // Club directions; the selector hides itself when empty.
  directions: Direction[]
  members: WorkspaceMember[]
  coachOptions: WorkspaceMember[]
  submitting: boolean
  // Set for a direction manager: the direction selector offers only their
  // directions — except while creating a group they coach themselves, which
  // their plain coach rights already cover in any direction.
  directionScope?: {
    allowedIds: readonly string[]
    defaultDirectionId: string | null
    ownUserId: string | null
  }
  onCancel: () => void
  onSubmit: (payload: GroupFormPayload) => Promise<void>
}

export function GroupForm({
  mode,
  initial,
  gyms,
  directions,
  members,
  coachOptions,
  submitting,
  directionScope,
  onCancel,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "")
  const [gymId, setGymId] = useState(initial?.gymId ?? gyms[0]?.id ?? "")
  const [coachId, setCoachId] = useState(initial?.coachId ?? "")
  const [directionId, setDirectionId] = useState<string | null>(
    initial ? initial.directionId : (directionScope?.defaultDirectionId ?? null),
  )
  const [memberIds, setMemberIds] = useState<string[]>(initial?.memberIds ?? [])
  const [memberQuery, setMemberQuery] = useState("")
  const [bookingMode, setBookingMode] = useState<GroupBookingMode>(
    initial?.bookingMode ?? "FIXED",
  )
  const [capacity, setCapacity] = useState(intToInput(initial?.capacity))
  const [windowDays, setWindowDays] = useState(
    intToInput(initial?.bookingWindowDays),
  )
  const [cancelHours, setCancelHours] = useState(
    intToInput(initial?.bookingCancelHours),
  )
  const parsedCapacity = parseOptionalInt(capacity, { min: 1, max: 1000 })
  const parsedWindow = parseOptionalInt(windowDays, { min: 0, max: 90 })
  const parsedCancel = parseOptionalInt(cancelHours, { min: 0, max: 168 })
  const bookingInvalid =
    bookingMode === "BOOKING" &&
    (!parsedCapacity.ok || !parsedWindow.ok || !parsedCancel.ok)
  const visibleMembers = members.filter((m) => matchesMemberQuery(m, memberQuery))

  const toggleMember = (userId: string) => {
    setMemberIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    )
  }

  const ownGroupInCreate =
    mode === "create" &&
    !!directionScope?.ownUserId &&
    coachId === directionScope.ownUserId
  const allowedDirectionIds =
    directionScope && !ownGroupInCreate ? directionScope.allowedIds : undefined

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !gymId || !coachId || bookingInvalid) return
    // A fixed group keeps its booking settings untouched: they only matter
    // once it is switched to booking mode again.
    const keep = bookingMode !== "BOOKING"
    void onSubmit({
      name: name.trim(),
      gymId,
      coachId,
      directionId,
      memberIds,
      bookingMode,
      capacity: keep
        ? (initial?.capacity ?? null)
        : parsedCapacity.ok
          ? parsedCapacity.value
          : null,
      bookingWindowDays: keep
        ? (initial?.bookingWindowDays ?? null)
        : parsedWindow.ok
          ? parsedWindow.value
          : null,
      bookingCancelHours: keep
        ? (initial?.bookingCancelHours ?? null)
        : parsedCancel.ok
          ? parsedCancel.value
          : null,
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

      <DirectionSelect
        id="group-direction"
        directions={directions}
        value={directionId}
        onChange={setDirectionId}
        allowedIds={allowedDirectionIds}
      />

      <div className="space-y-3 rounded-md border border-border p-3">
        <div>
          <Label>Режим группы</Label>
          <Select
            value={bookingMode}
            onValueChange={(v) => setBookingMode(v as GroupBookingMode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FIXED">Постоянная группа</SelectItem>
              <SelectItem value="BOOKING">Запись на занятие</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            {bookingMode === "BOOKING"
              ? "Ученики клуба сами записываются на каждое занятие в расписании; при заполнении — лист ожидания."
              : "На занятия ходят ученики группы; другие могут прийти разово."}
          </p>
          {mode === "edit" &&
            initial?.bookingMode === "BOOKING" &&
            bookingMode === "FIXED" && (
              <p className="mt-1 text-xs text-amber-700">
                Все записи на будущие занятия будут отменены, ученики получат
                уведомление.
              </p>
            )}
        </div>

        {bookingMode === "BOOKING" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="group-capacity">Мест на занятии</Label>
              <Input
                id="group-capacity"
                inputMode="numeric"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="без ограничений"
              />
              {!parsedCapacity.ok && (
                <p className="text-xs text-destructive">
                  Целое число от 1 до 1000 или пусто
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="group-window-days">
                Запись открывается за N дней
              </Label>
              <Input
                id="group-window-days"
                inputMode="numeric"
                value={windowDays}
                onChange={(e) => setWindowDays(e.target.value)}
                placeholder="как в настройках клуба"
              />
              {!parsedWindow.ok && (
                <p className="text-xs text-destructive">
                  Целое число от 0 до 90 или пусто
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="group-cancel-hours">
                Бесплатная отмена за N часов
              </Label>
              <Input
                id="group-cancel-hours"
                inputMode="numeric"
                value={cancelHours}
                onChange={(e) => setCancelHours(e.target.value)}
                placeholder="как в настройках клуба"
              />
              {!parsedCancel.ok && (
                <p className="text-xs text-destructive">
                  Целое число от 0 до 168 или пусто
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Расписание группы и отмены задаются ниже после сохранения карточки.
      </p>

      <div className="space-y-1.5">
        <Label>Ученики ({memberIds.length} выбрано)</Label>
        {members.length > 0 && (
          <Input
            type="search"
            value={memberQuery}
            onChange={(e) => setMemberQuery(e.target.value)}
            placeholder="Поиск по имени или email"
            className="h-9"
          />
        )}
        <div className="max-h-48 overflow-y-auto rounded-md border border-border">
          {members.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              В клубе пока нет учеников
            </p>
          ) : visibleMembers.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              Никто не подходит под «{memberQuery}»
            </p>
          ) : (
            visibleMembers.map((m) => (
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
          disabled={
            submitting || !name.trim() || !gymId || !coachId || bookingInvalid
          }
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
