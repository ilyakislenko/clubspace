import { redirect } from "next/navigation"

type Params = Promise<{ workspaceId: string }>

export default async function VideosLegacyRedirect({
  params,
}: {
  params: Params
}) {
  const { workspaceId } = await params
  redirect(`/workspace/${workspaceId}/content`)
}
