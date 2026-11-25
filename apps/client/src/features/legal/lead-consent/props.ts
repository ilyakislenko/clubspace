// What a trial-request consent edition prints: the club is the operator, so
// every edition names it, its address and how to reach it. Filled from
// GET /public/clubs/:slug/trial (the operator fields are required before a
// club can switch its form on).
export type LeadConsentProps = {
  operatorName: string
  operatorAddress: string
  clubName: string
  contacts: Array<{ label: string; phone: string }>
}
