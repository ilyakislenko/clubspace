import { redirect } from "next/navigation"

type Params = Promise<{ workspaceId: string }>

// «Кому позвонить» is one list now (docs/design/2026-11-08-admin-cleanup.md B1).
export default async function ChurnLegacyRedirect({
  params,
}: {
  params: Params
}) {
  const { workspaceId } = await params
  redirect(`/workspace/${workspaceId}/retention`)
}
