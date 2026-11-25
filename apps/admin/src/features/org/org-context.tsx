"use client"

import { createContext, useContext } from "react"

import type { Organization } from "../../shared/api/organizations"

// The federation open in the console (`/org/<id>`), set by its layout once
// `GET orgs/:id` answers: pages never mount before it.
export type OrgScope = {
  org: Organization
  // ORG_ADMIN (or the platform owner): clubs, team, settings, announcements.
  isAdmin: boolean
  // Re-reads the federation (after its profile is saved).
  reload: () => void
}

const OrgContext = createContext<OrgScope | null>(null)

export const OrgScopeProvider = OrgContext.Provider

export const useOrg = (): OrgScope => {
  const scope = useContext(OrgContext)
  if (!scope) throw new Error("useOrg outside the federation console")
  return scope
}
