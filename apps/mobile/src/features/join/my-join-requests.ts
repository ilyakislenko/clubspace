import type { JoinRequest } from "../../shared/api/join"

export type JoinRequestRow = {
  workspaceId: string
  workspaceName: string
  status: JoinRequest["status"]
  label: string
}

/**
 * Profile «Мои заявки»: every open request, like onboarding lists them. A
 * branded build puts its own club first (onboarding reports on it first too);
 * then pending before rejected, newest first.
 */
export const myJoinRequestRows = (
  requests: readonly JoinRequest[],
  brandKey: string | null,
): JoinRequestRow[] => {
  const rank = (r: JoinRequest) =>
    (r.workspaceKey === brandKey ? 0 : 2) + (r.status === "pending" ? 0 : 1)
  return [...requests]
    .sort(
      (a, b) =>
        rank(a) - rank(b) || b.requestedAt.localeCompare(a.requestedAt),
    )
    .map((r) => ({
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      status: r.status,
      label:
        r.status === "pending" ? "Ожидает подтверждения" : "Заявка отклонена",
    }))
}
