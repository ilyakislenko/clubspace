import type { JoinRequest } from "../../shared/api/join"
import { myJoinRequestRows } from "./my-join-requests"

const req = (
  workspaceKey: string,
  status: JoinRequest["status"],
  requestedAt = "2026-10-25T10:00:00.000Z",
): JoinRequest => ({
  workspaceId: `id-${workspaceKey}`,
  workspaceName: `Клуб ${workspaceKey}`,
  workspaceKey,
  status,
  requestedAt,
})

describe("myJoinRequestRows", () => {
  it("is empty without requests", () => {
    expect(myJoinRequestRows([], null)).toEqual([])
  })

  it("labels pending and rejected requests", () => {
    expect(myJoinRequestRows([req("a", "pending"), req("b", "rejected")], null)).toEqual([
      {
        workspaceId: "id-a",
        workspaceName: "Клуб a",
        status: "pending",
        label: "Ожидает подтверждения",
      },
      {
        workspaceId: "id-b",
        workspaceName: "Клуб b",
        status: "rejected",
        label: "Заявка отклонена",
      },
    ])
  })

  it("orders pending before rejected, newest first", () => {
    const rows = myJoinRequestRows(
      [
        req("old-rejected", "rejected", "2026-10-01T00:00:00.000Z"),
        req("old", "pending", "2026-10-01T00:00:00.000Z"),
        req("new", "pending", "2026-10-20T00:00:00.000Z"),
      ],
      null,
    )
    expect(rows.map((r) => r.workspaceId)).toEqual([
      "id-new",
      "id-old",
      "id-old-rejected",
    ])
  })

  it("puts the branded build's own club first, even when rejected", () => {
    const rows = myJoinRequestRows(
      [req("other", "pending"), req("bars", "rejected")],
      "bars",
    )
    expect(rows.map((r) => r.workspaceId)).toEqual(["id-bars", "id-other"])
  })
})
