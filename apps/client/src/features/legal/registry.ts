import { Autopay20261116 } from "./autopay/autopay-2026-11-16"
import { Dpa20261101 } from "./dpa/dpa-2026-11-01"
import { Dpa20261201 } from "./dpa/dpa-2026-12-01"
import type { EditionRegistry } from "./editions"
import { Offer20261101 } from "./offer/offer-2026-11-01"

// Every published edition, keyed by the version the server announces in
// PLATFORM_OFFER_VERSION / PLATFORM_DPA_VERSION. Publishing a new edition =
// a new file + an entry here, then the env bump (docs/legal/README.md).
export const OFFER_EDITIONS: EditionRegistry = {
  "2026-11-01": Offer20261101,
}

// 2026-12-01 adds trial-request subjects; the server's LEADS_DPA_MIN_VERSION
// names it (specs/legal-lead-consent.spec.tsx).
export const DPA_EDITIONS: EditionRegistry = {
  "2026-11-01": Dpa20261101,
  "2026-12-01": Dpa20261201,
}

// Member autopay terms, keyed by the server's AUTOPAY_CONSENT_VERSION
// (apps/server/src/domains/autopay/autopay-consent.ts — a code constant, not
// env). The newest edition is the one in force and must equal it
// (specs/legal-autopay.spec.tsx), so a new edition ships with the server bump.
export const AUTOPAY_EDITIONS: EditionRegistry = {
  "2026-11-16": Autopay20261116,
}
