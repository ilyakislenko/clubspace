import type { ComponentType } from "react"

import { currentEditionVersion, findEdition } from "../editions"
import { LeadConsent20261201 } from "./lead-consent-2026-12-01"
import type { LeadConsentProps } from "./props"

// The consent a person gives on /c/<slug>/trial, keyed by the server's
// LEAD_CONSENT_VERSION (apps/server/src/domains/leads/lead-consent.ts — a code
// constant, the autopay pattern). The form sends the version it showed and the
// server refuses any other, so the newest edition here is the one in force and
// must equal the constant (specs/legal-lead-consent.spec.tsx): a new edition
// ships with the server bump in one deploy.
export const LEAD_CONSENT_EDITIONS: Record<
  string,
  ComponentType<LeadConsentProps>
> = {
  "2026-12-01": LeadConsent20261201,
}

// The edition the trial form shows and sends: the server's version when we
// have its text (always, after a joint deploy), else our newest — the server
// then answers «Текст согласия обновился — обновите страницу».
export const leadConsentEdition = (serverVersion: string | null) => {
  const version = currentEditionVersion(LEAD_CONSENT_EDITIONS, serverVersion)
  const Text = findEdition(LEAD_CONSENT_EDITIONS, version)
  if (!Text) throw new Error(`Lead consent edition ${version} is missing`)
  return { version, Text }
}
