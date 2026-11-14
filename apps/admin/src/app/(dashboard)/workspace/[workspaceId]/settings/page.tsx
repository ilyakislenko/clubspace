"use client"

import { useParams } from "next/navigation"

import { ClubProfileForm } from "../../../../../features/club-profile/ClubProfileForm"

// «Настройки → Профиль клуба», the default settings section.
export default function SettingsProfilePage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  return workspaceId ? <ClubProfileForm workspaceId={workspaceId} /> : null
}
