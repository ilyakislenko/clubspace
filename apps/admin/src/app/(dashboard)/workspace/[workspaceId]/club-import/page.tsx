"use client"

import { useParams } from "next/navigation"

import { ClubImportWizard } from "../../../../../features/club-import/ClubImportWizard"

export default function ClubImportPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Импорт клуба</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ученики, группы, абонементы и пояса из таблицы Excel — всех залов и
          направлений за раз.
        </p>
      </div>
      {workspaceId && <ClubImportWizard workspaceId={workspaceId} />}
    </div>
  )
}
