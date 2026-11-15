"use client"

import { useState } from "react"

import { cap } from "@clubspace/ui-kit/brand"
import { Button, Input, Label, Textarea } from "@clubspace/ui-kit/ui"

import {
  acceptPersonalTraining,
  declinePersonalTraining,
  proposePersonalTrainingTime,
} from "../../shared/api/personal-trainings"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { confirmLeave, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { ErrorNote, Fact, Facts, useDecision, type DecisionProps } from "./decision-kit"
import { formatSentAt, optionLabel } from "./request-view"

const PROPOSE = FORM_LIMITS.personalPropose
const CLOSE = FORM_LIMITS.personalClose

// Today in the request's time zone ("YYYY-MM-DD"): the earliest day to offer.
const todayIn = (timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  )

/**
 * «Персональная» (the club's word): confirm one of the member's times, offer
 * another, or decline. A lead acting for the chosen coach is told that the
 * coach is notified too (the server's rule).
 */
export function PersonalDecision(props: DecisionProps) {
  const { workspaceId, request, viewerId } = props
  const vocabulary = useVocabulary()
  const personal = request.personal
  const initialDuration = String(personal?.options[0]?.durationMin ?? 60)
  const [mode, setMode] = useState<"view" | "propose" | "decline">("view")
  const [optionId, setOptionId] = useState(personal?.options[0]?.id ?? null)
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [durationText, setDurationText] = useState(initialDuration)
  const [comment, setComment] = useState("")
  const [touched, setTouched] = useState(false)
  const { busy, error, decide } = useDecision(props)

  useDirtyGuard(
    (mode === "propose" &&
      (date !== "" || time !== "" || durationText !== initialDuration || comment.trim() !== "")) ||
      (mode === "decline" && comment.trim() !== ""),
  )

  if (!personal) return null
  // Unknown viewer (still loading): no «Вы отвечаете за …» that may be about oneself.
  const forCoach =
    viewerId !== null && personal.coach.userId !== viewerId ? personal.coach.name : null
  const duration = parseIntInput(durationText, PROPOSE.durationMin)

  const openMode = (next: "propose" | "decline") => {
    setComment("")
    setTouched(false)
    setMode(next)
  }

  const backToView = async () => {
    if (!(await confirmLeave())) return
    setMode("view")
    setDate("")
    setTime("")
    setDurationText(initialDuration)
    setComment("")
  }

  const propose = () => {
    setTouched(true)
    if (!date || !time || duration === null) return
    void decide(
      () =>
        proposePersonalTrainingTime({
          workspaceId,
          requestId: request.requestId,
          data: { startAt: `${date}T${time}`, durationMin: duration, comment: comment.trim() || undefined },
        }),
      "Не удалось предложить время",
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Facts>
        <Fact label={cap(vocabulary.coach.nom)}>{forCoach}</Fact>
        <Fact label="Зал">{personal.gymName}</Fact>
        <Fact label="Комментарий ученика">{personal.memberComment}</Fact>
        <Fact label="Отправлена">{formatSentAt(request.createdAt, new Date())}</Fact>
      </Facts>

      {forCoach && (
        <p className="text-sm text-muted-foreground">
          Вы отвечаете за {forCoach}: уведомление получат ученик и {forCoach}.
        </p>
      )}

      {error && <ErrorNote message={error} />}

      {mode === "view" && (
        <>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Время</span>
            <div role="radiogroup" aria-label="Время" className="space-y-1.5 text-sm">
              {personal.options.map((option) => (
                <label key={option.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="personal-option"
                    checked={optionId === option.id}
                    disabled={busy}
                    onChange={() => setOptionId(option.id)}
                  />
                  {optionLabel(option, personal.timezone)}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy || optionId === null}
              onClick={() =>
                optionId &&
                void decide(
                  () =>
                    acceptPersonalTraining({
                      workspaceId,
                      requestId: request.requestId,
                      data: { optionId },
                    }),
                  "Не удалось подтвердить время",
                )
              }
            >
              {busy ? "Подтверждаем…" : "Подтвердить"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => openMode("propose")}>
              Предложить другое время
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => openMode("decline")}>
              Отклонить
            </Button>
          </div>
        </>
      )}

      {mode === "propose" && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            propose()
          }}
        >
          <div className="flex flex-wrap gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="personal-date">Дата</Label>
              <Input
                id="personal-date"
                type="date"
                min={todayIn(personal.timezone)}
                value={date}
                disabled={busy}
                onChange={(e) => setDate(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="personal-time">Время</Label>
              <Input
                id="personal-time"
                type="time"
                step={300}
                value={time}
                disabled={busy}
                onChange={(e) => setTime(e.target.value)}
                className="w-[120px]"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="personal-duration">Длительность, мин</Label>
              <Input
                id="personal-duration"
                inputMode="numeric"
                value={durationText}
                disabled={busy}
                onChange={(e) => setDurationText(e.target.value)}
                className="w-[120px]"
              />
            </div>
          </div>
          {touched && (!date || !time) && (
            <p className="text-xs text-destructive">Укажите дату и время</p>
          )}
          {duration === null && (
            <p className="text-xs text-destructive">
              Длительность от {PROPOSE.durationMin.min} до {PROPOSE.durationMin.max} минут
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="personal-propose-comment">Комментарий (увидит ученик)</Label>
            <Textarea
              id="personal-propose-comment"
              rows={2}
              value={comment}
              maxLength={PROPOSE.comment.max}
              disabled={busy}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Отправляем…" : "Предложить"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void backToView()}>
              Отмена
            </Button>
          </div>
        </form>
      )}

      {mode === "decline" && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void decide(
              () =>
                declinePersonalTraining({
                  workspaceId,
                  requestId: request.requestId,
                  data: { comment: comment.trim() || undefined },
                }),
              "Не удалось отклонить заявку",
            )
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="personal-decline-comment">Комментарий (увидит ученик)</Label>
            <Textarea
              id="personal-decline-comment"
              rows={3}
              value={comment}
              maxLength={CLOSE.comment.max}
              disabled={busy}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? "Отклоняем…" : "Отклонить"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void backToView()}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
