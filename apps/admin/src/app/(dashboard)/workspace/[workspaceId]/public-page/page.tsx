"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { PublicProfileSection } from "../../../../../features/public-profile/PublicProfileSection"
import { fetchWorkspaces } from "../../../../../shared/api/workspaces"

export default function PublicPagePage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId ?? ""
  // Only for the preview card; the form works without it.
  const [clubName, setClubName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchWorkspaces()
      .then((list) => {
        if (cancelled) return
        setClubName(list.find((w) => w.workspaceId === workspaceId)?.name ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Публичная страница</h1>
        <p className="text-sm text-muted-foreground">
          Что видят люди, которые ещё не в клубе: страница по ссылке-приглашению
          и QR-коду, страница клуба и каталог клубов.
        </p>
      </div>
      {workspaceId && (
        <PublicProfileSection workspaceId={workspaceId} clubName={clubName} />
      )}
    </div>
  )
}
