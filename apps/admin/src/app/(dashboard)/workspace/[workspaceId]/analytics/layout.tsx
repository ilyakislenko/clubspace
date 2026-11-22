"use client"

import { usePathname } from "next/navigation"

import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { SectionTabs } from "../../../../../shared/workspace/section-tabs"
import { reportTabs } from "../sections"

// «Отчёты»: one title and tab row over every report. The bare /analytics
// only forwards to a tab, so it gets no header.
export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const vocabulary = useVocabulary()
  const pathname = usePathname()
  if (pathname?.endsWith("/analytics")) return <>{children}</>
  return (
    <div className="space-y-6">
      <SectionTabs title="Отчёты" tabs={reportTabs(vocabulary)} />
      {children}
    </div>
  )
}
