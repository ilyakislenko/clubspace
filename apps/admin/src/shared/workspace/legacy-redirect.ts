import { redirect } from "next/navigation"

export type SearchParams = Record<string, string | string[] | undefined>

// Props Next passes to a page under `workspace/[workspaceId]`.
export type LegacyPageProps = {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<SearchParams>
}

// `path` with the old page's query string kept, so bookmarked filters and
// tabs survive a route move.
export const withQuery = (path: string, searchParams: SearchParams): string => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v)
  }
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

// Server-side redirect from a moved admin route to `/workspace/<id>/<target>`.
export const redirectInWorkspace = async (
  { params, searchParams }: LegacyPageProps,
  target: string,
): Promise<never> => {
  const { workspaceId } = await params
  redirect(withQuery(`/workspace/${workspaceId}/${target}`, await searchParams))
}
