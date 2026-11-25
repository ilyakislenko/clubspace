// Where «Выберите клуб» sends an account straight away, or `list` to show the
// choice. Platform staff without clubs go to the console; one admin club and
// no federation opens the club; one federation and no admin club opens the
// federation (docs/design/2026-11-26-federation-hub-mvp.md §4.1).
export type PickerLanding =
  | { kind: "platform" }
  | { kind: "club"; workspaceId: string }
  | { kind: "org"; organizationId: string }
  | { kind: "list" }

export const pickerLanding = (p: {
  isSuperAdmin: boolean
  adminClubIds: readonly string[]
  organizationIds: readonly string[]
}): PickerLanding => {
  const clubs = p.adminClubIds.length
  const orgs = p.organizationIds.length
  if (p.isSuperAdmin) return clubs === 0 && orgs === 0 ? { kind: "platform" } : { kind: "list" }
  if (clubs === 1 && orgs === 0) return { kind: "club", workspaceId: p.adminClubIds[0] }
  if (clubs === 0 && orgs === 1) return { kind: "org", organizationId: p.organizationIds[0] }
  return { kind: "list" }
}
