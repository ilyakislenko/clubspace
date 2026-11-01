"use client"

import { useParams } from "next/navigation"

import { AiAssistantCard } from "../../../../../features/ai-assistant/AiAssistantCard"

// «Интеграции»: connections of the club to outside tools. Today — the
// ИИ-ассистент (MCP, docs/mcp.md).
export default function IntegrationsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Интеграции</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Подключения клуба к внешним сервисам.
        </p>
      </div>
      {workspaceId && <AiAssistantCard workspaceId={workspaceId} />}
    </div>
  )
}
