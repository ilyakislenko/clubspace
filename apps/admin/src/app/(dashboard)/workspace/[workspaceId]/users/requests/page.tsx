"use client"

import { useParams } from "next/navigation"

import { RequestsInbox } from "../../../../../../features/requests/RequestsInbox"

// «Ученики → Заявки»: join, freeze, personal-session and video-review requests
// waiting for this viewer's decision, oldest first.
export default function MemberRequestsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return <RequestsInbox workspaceId={workspaceId} />
}
