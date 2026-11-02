import { kvGet, kvSet } from "../../shared/kv"
import { isClubPaymentMethod, type ClubPaymentMethod } from "./payment-method"

// SecureStore keys allow [A-Za-z0-9._-] only.
const KEY = "clubspace.paymentMethod"

// The method last picked on this device — a club mostly takes one way, so the
// next payment starts there; «Наличные» the first time.
export const loadPaymentMethod = async (): Promise<ClubPaymentMethod> => {
  const stored = await kvGet(KEY).catch(() => null)
  return isClubPaymentMethod(stored) ? stored : "CASH"
}

export const savePaymentMethod = (method: ClubPaymentMethod): Promise<void> =>
  kvSet(KEY, method).catch(() => undefined)
