import { Fragment, type ReactNode } from "react"

import {
  GUARDIAN_LINE_PREFIX,
  guardianName,
} from "../../shared/lib/guardians"
import type { MemberGuardian } from "../../shared/api/members"

// A child's guardians, one line each: «Родитель: Имя Фамилия · email · phone»,
// with e-mail/phone as links and a hint when the guardian hasn't confirmed yet.
export function GuardianContacts({
  guardians,
  className = "text-xs text-muted-foreground",
}: {
  guardians: readonly MemberGuardian[]
  className?: string
}) {
  if (guardians.length === 0) return null
  return (
    <ul className={`space-y-0.5 ${className}`}>
      {guardians.map((g) => {
        const parts: ReactNode[] = []
        const name = guardianName(g)
        if (name) parts.push(<span key="name">{name}</span>)
        if (g.email)
          parts.push(
            <a key="email" href={`mailto:${g.email}`} className="hover:underline">
              {g.email}
            </a>,
          )
        if (g.phone)
          parts.push(
            <a
              key="phone"
              href={`tel:${g.phone}`}
              className="text-primary hover:underline"
            >
              {g.phone}
            </a>,
          )
        return (
          <li key={g.userId} className="break-words">
            <span>{GUARDIAN_LINE_PREFIX[g.relation]}: </span>
            {parts.length === 0
              ? "—"
              : parts.map((part, i) => (
                  <Fragment key={i}>
                    {i > 0 && " · "}
                    {part}
                  </Fragment>
                ))}
            {!g.confirmed && (
              <span className="ml-1 text-amber-600 dark:text-amber-500">
                (ожидает подтверждения)
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
