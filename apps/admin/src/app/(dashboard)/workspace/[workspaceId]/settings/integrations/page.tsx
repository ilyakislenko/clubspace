"use client"

import { useParams } from "next/navigation"

import { AiAssistantCard } from "../../../../../../features/ai-assistant/AiAssistantCard"
import { SettingsSectionHeader } from "../../../../../../features/settings/SettingsNav"

// «Настройки → Интеграции»: connections of the club to outside tools. Today —
// the ИИ-ассистент (MCP, docs/mcp.md).
export default function SettingsIntegrationsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  return (
    <>
      <SettingsSectionHeader
        title="Интеграции"
        description="Подключения клуба к внешним сервисам."
      />
      {workspaceId && <AiAssistantCard workspaceId={workspaceId} />}
    </>
  )
}
