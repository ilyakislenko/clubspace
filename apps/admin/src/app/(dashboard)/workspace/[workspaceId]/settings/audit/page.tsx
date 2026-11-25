"use client"

import { useParams } from "next/navigation"
import { useCallback, useState } from "react"

import { listAuditEvents } from "../../../../../../shared/api/audit"
import {
  ACTION_CATEGORIES,
  ACTION_CATEGORY_LABELS,
} from "../../../../../../features/audit/audit-meta"
import { AuditFeed } from "../../../../../../features/audit/AuditFeed"
import { SettingsSectionHeader } from "../../../../../../features/settings/SettingsNav"
import { useVocabulary } from "../../../../../../shared/lib/vocabulary"

// «Настройки → История изменений»: the club's audit feed.
export default function SettingsAuditPage() {
  const vocabulary = useVocabulary()
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const [category, setCategory] = useState("")

  const load = useCallback(
    (p: { curPage: number; perPage: number; actionPrefix?: string }) =>
      listAuditEvents({ workspaceId: workspaceId ?? "", ...p }),
    [workspaceId],
  )

  return (
    <>
      <SettingsSectionHeader
        title="История изменений"
        description="Кто и что делал в клубе. Видят владелец и администраторы."
        action={
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Фильтр по разделу"
          >
            <option value="">Все разделы</option>
            {ACTION_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {ACTION_CATEGORY_LABELS[cat] ?? cat}
              </option>
            ))}
          </select>
        }
      />
      {workspaceId && (
        <AuditFeed
          key={category}
          load={load}
          actionPrefix={category ? `${category}.` : undefined}
          emptyHint={`Здесь появятся записи, когда ${vocabulary.coach.nom} или администратор что-то изменит в клубе.`}
        />
      )}
    </>
  )
}
