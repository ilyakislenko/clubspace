"use client"

import { useParams } from "next/navigation"

import { MessagesPage } from "../../../../../../features/messages/MessagesPage"

// «Ученики → Сообщения»: messages from the club to students, a segment or one
// student, with who got and opened each.
export default function MemberMessagesPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  if (!workspaceId) return null
  return <MessagesPage workspaceId={workspaceId} />
}
