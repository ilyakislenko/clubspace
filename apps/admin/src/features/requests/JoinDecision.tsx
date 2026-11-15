"use client"

import { useState } from "react"

import { Button, Label, Textarea } from "@clubspace/ui-kit/ui"

import { addWorkspaceMember, rejectPendingMember } from "../../shared/api/members"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { confirmLeave, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { ErrorNote, Fact, Facts, useDecision, type DecisionProps } from "./decision-kit"
import { formatSentAt, guardiansLine, joinRole } from "./request-view"

const COMMENT = FORM_LIMITS.joinReject.comment

/**
 * «Вступление»: accept the applicant at once, or decline with an optional
 * comment the person sees. The decline form is the confirmation: no dialog.
 */
export function JoinDecision({
  startInDecline,
  ...props
}: DecisionProps & { startInDecline: boolean }) {
  const { workspaceId, request } = props
  const vocabulary = useVocabulary()
  const [declining, setDeclining] = useState(startInDecline)
  const [comment, setComment] = useState("")
  const { busy, error, decide } = useDecision(props)

  useDirtyGuard(declining && comment.trim() !== "")

  const role = joinRole(request, vocabulary)
  const who = request.member.isDependent
    ? ["Ребёнок", guardiansLine(request.member)].filter(Boolean).join(" · ")
    : request.member.email

  const accept = () =>
    decide(
      // By id: works for a child profile a parent filed by code (no e-mail).
      () => addWorkspaceMember({ workspaceId, data: { userId: request.requestId } }),
      "Не удалось принять заявку",
    )

  const reject = () =>
    decide(
      () =>
        rejectPendingMember({
          workspaceId,
          userId: request.requestId,
          comment: comment.trim() || undefined,
        }),
      "Не удалось отклонить заявку",
    )

  const cancelDecline = async () => {
    if (await confirmLeave()) {
      setDeclining(false)
      setComment("")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Facts>
        <Fact label={request.member.isDependent ? "Профиль" : "Эл. почта"}>{who}</Fact>
        <Fact label="Роль">{role}</Fact>
        <Fact label="Заявка от">{formatSentAt(request.createdAt, new Date())}</Fact>
      </Facts>

      {error && <ErrorNote message={error} />}

      {declining ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void reject()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="join-reject-comment">Комментарий (увидит человек)</Label>
            <Textarea
              id="join-reject-comment"
              rows={3}
              value={comment}
              maxLength={COMMENT.max}
              disabled={busy}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Человек не попадёт в клуб и не сможет подать заявку снова по коду клуба.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? "Отклоняем…" : "Отклонить заявку"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void cancelDecline()}>
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void accept()}>
            {busy ? "Принимаем…" : "Принять"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setDeclining(true)}>
            Отклонить
          </Button>
        </div>
      )}
    </div>
  )
}
