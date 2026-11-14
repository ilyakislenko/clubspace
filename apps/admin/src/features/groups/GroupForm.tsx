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
import { formatMemberLabel } from "./helpers"
import { MemberSearchPicker } from "./MemberSearchPicker"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { agree, cap } from "@clubspace/ui-kit/brand"

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
    bookingMode: GroupBookingMode
    capacity: number | null
    bookingWindowDays: number | null
    bookingCancelHours: number | null
  }
  gyms: Gym[]
  // Club directions; the selector hides itself when empty.
  directions: Direction[]
  // Staff who may coach a group.
  coachOptions: WorkspaceMember[]
  // Needed in create mode: the student picker searches the club server-side.
  workspaceId: string
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
  coachOptions,
  workspaceId,
  submitting,
  directionScope,
  onCancel,
  onSubmit,
}: Props) {
  const vocabulary = useVocabulary()
  const [name, setName] = useState(initial?.name ?? "")
  const [gymId, setGymId] = useState(initial?.gymId ?? gyms[0]?.id ?? "")
  const [coachId, setCoachId] = useState(initial?.coachId ?? "")
  const [directionId, setDirectionId] = useState<string | null>(
    initial ? initial.directionId : (directionScope?.defaultDirectionId ?? null),
  )
  // Students to enrol at creation; later the roster lives on the group card.
  const [picked, setPicked] = useState<WorkspaceMember[]>([])
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
  const pickedIds = new Set(picked.map((m) => m.userId))
  if (coachId) pickedIds.add(coachId)


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
      memberIds: mode === "create" ? picked.map((m) => m.userId) : undefined,
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
    <form onSubmit={handleSubmit} className="space-y-4">
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
          <Label>{cap(vocabulary.coach.nom)}</Label>
          <Select
            value={coachId}
            onValueChange={(next) => {
              setCoachId(next)
              // The new coach can't simultaneously be a student of the
              // same group — drop them from the desired member list when
              // they get promoted.
              setPicked((prev) => prev.filter((m) => m.userId !== next))
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
              <SelectItem value="BOOKING">Запись на {vocabulary.session.acc}</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            {bookingMode === "BOOKING"
              ? `Ученики клуба сами записываются на ${agree(vocabulary.session, "каждую", "каждое")} ${vocabulary.session.acc} в расписании; при заполнении — лист ожидания.`
              : `На ${vocabulary.session.nomPl} ходят ученики группы; другие могут прийти разово.`}
          </p>
          {mode === "edit" &&
            initial?.bookingMode === "BOOKING" &&
            bookingMode === "FIXED" && (
              <p className="mt-1 text-xs text-amber-700">
                Все записи на будущие {vocabulary.session.nomPl} будут отменены, ученики получат
                уведомление.
              </p>
            )}
        </div>

        {bookingMode === "BOOKING" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="group-capacity">Мест на {vocabulary.session.prep}</Label>
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

      {mode === "create" && (
        <div className="space-y-1.5">
          <Label>Ученики</Label>
          <MemberSearchPicker
            workspaceId={workspaceId}
            excludeIds={pickedIds}
            onPick={(m) => setPicked((prev) => [...prev, m])}
          />
          {picked.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 pt-1">
              {picked.map((m) => (
                <li
                  key={m.userId}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                >
                  {formatMemberLabel(m)}
                  <button
                    type="button"
                    onClick={() =>
                      setPicked((prev) => prev.filter((p) => p.userId !== m.userId))
                    }
                    className="rounded-full px-1 text-muted-foreground hover:bg-muted-foreground/20"
                    aria-label={`Убрать ${formatMemberLabel(m)}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Можно добавить и позже, в карточке группы. Время {vocabulary.session.genPl} задаётся
            в «Расписании».
          </p>
        </div>
      )}

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
