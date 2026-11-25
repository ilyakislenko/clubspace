"use client"

import { useParams } from "next/navigation"

import { ClubFederationSettings } from "../../../../../../features/settings/ClubFederationSettings"

// «Настройки → Федерация»: invitations and what the club shares.
export default function SettingsFederationPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  return workspaceId ? <ClubFederationSettings workspaceId={workspaceId} /> : null
}
