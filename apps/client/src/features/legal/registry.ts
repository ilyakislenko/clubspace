import { Dpa20261101 } from "./dpa/dpa-2026-11-01"
import type { EditionRegistry } from "./editions"
import { Offer20261101 } from "./offer/offer-2026-11-01"

// Every published edition, keyed by the version the server announces in
// PLATFORM_OFFER_VERSION / PLATFORM_DPA_VERSION. Publishing a new edition =
// a new file + an entry here, then the env bump (docs/legal/README.md).
export const OFFER_EDITIONS: EditionRegistry = {
  "2026-11-01": Offer20261101,
}

export const DPA_EDITIONS: EditionRegistry = {
  "2026-11-01": Dpa20261101,
}
