"use client"

import { useState } from "react"

import { Button, Label, Textarea } from "@clubspace/ui-kit/ui"

import {
  approveSubscriptionFreezeRequest,
  declineSubscriptionFreezeRequest,
} from "../../shared/api/subscriptions"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { pluralRu } from "../../shared/lib/plural-ru"
import { confirmLeave, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { FreezeForm } from "../subscriptions/FreezeForm"
import { formatDay, todayYmd } from "../subscriptions/freeze-utils"
import { ErrorNote, Fact, Facts, useDecision, type DecisionProps } from "./decision-kit"
import { formatSentAt } from "./request-view"

const DECLINE = FORM_LIMITS.freeze.declineComment

/**
 * «Заморозка»: approve with the member card's form (prefilled exactly as the
 * card does), or decline with a comment the member sees. The card keeps
 * showing the same request until it is decided; both call the same endpoints.
 */
export function FreezeDecision(props: DecisionProps) {
  const { workspaceId, request } = props
  const freeze = request.freeze
  const [mode, setMode] = useState<"view" | "approve" | "decline">("view")
  const [comment, setComment] = useState("")
  const { busy, error, decide } = useDecision(props)

  useDirtyGuard(mode === "decline" && comment.trim() !== "")

  if (!freeze) return null
  const today = todayYmd(new Date())
  const endDate = freeze.subscriptionEndDate
    ? new Date(freeze.subscriptionEndDate).toLocaleDateString("ru-RU")
    : null

  const cancelDecline = async () => {
    if (await confirmLeave()) {
      setMode("view")
      setComment("")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Facts>
        <Fact label="Абонемент">
          {endDate ? `${freeze.planName}, до ${endDate}` : freeze.planName}
        </Fact>
        <Fact label="Просит">
          {`с ${formatDay(freeze.fromDate)} на ${freeze.days} ${pluralRu(freeze.days, "день", "дня", "дней")} (по ${formatDay(freeze.untilDate)})`}
        </Fact>
        <Fact label="Причина">{freeze.reason}</Fact>
        <Fact label="Отправлена">{formatSentAt(request.createdAt, new Date())}</Fact>
      </Facts>

      {error && <ErrorNote message={error} />}

      {mode === "view" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => setMode("approve")}>
            Одобрить
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setMode("decline")}>
            Отклонить
          </Button>
        </div>
      )}

      {mode === "approve" && (
        <FreezeForm
          endDate={freeze.subscriptionEndDate}
          initial={{
            days: freeze.days,
            fromDate: freeze.fromDate > today ? freeze.fromDate : today,
            reason: freeze.reason,
          }}
          submitLabel="Одобрить заморозку"
          busy={busy}
          onCancel={() => setMode("view")}
          onSubmit={(values) =>
            void decide(
              () =>
                approveSubscriptionFreezeRequest({
                  workspaceId,
                  requestId: request.requestId,
                  data: values,
                }),
              "Не удалось одобрить заявку",
            )
          }
        />
      )}

      {mode === "decline" && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void decide(
              () =>
                declineSubscriptionFreezeRequest({
                  workspaceId,
                  requestId: request.requestId,
                  data: { comment: comment.trim() || undefined },
                }),
              "Не удалось отклонить заявку",
            )
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="freeze-decline-comment">Комментарий (увидит ученик)</Label>
            <Textarea
              id="freeze-decline-comment"
              rows={3}
              value={comment}
              maxLength={DECLINE.max}
              disabled={busy}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? "Отклоняем…" : "Отклонить заявку"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void cancelDecline()}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
