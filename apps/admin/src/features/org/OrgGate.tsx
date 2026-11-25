"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { getOrganization, type Organization } from "../../shared/api/organizations"
import { OrgScopeProvider, type OrgScope } from "./org-context"
import { isOrgAdminRole } from "./org-view"

export const ORG_DENIED_TEXT = "Раздел доступен команде федерации"

// The server answers 404 to anyone outside the federation team (no existence
// leak), 403 when the feature is off for the account; both read as «not
// yours». Anything else is a failure worth retrying.
const isRefusal = (error: unknown): boolean => {
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  return status === 403 || status === 404
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; org: Organization }
  | { kind: "denied" }
  | { kind: "failed" }

// The federation console mounts only for its team: reads `GET orgs/:id` and
// shows a notice otherwise, so a club owner who types the URL fires no
// further requests.
export function OrgGate({
  orgId,
  children,
}: {
  orgId: string
  children: React.ReactNode
}) {
  const [state, setState] = useState<State>({ kind: "loading" })

  const load = useCallback(async () => {
    try {
      const org = await getOrganization({ organizationId: orgId })
      setState({ kind: "ready", org })
    } catch (error) {
      setState({ kind: isRefusal(error) ? "denied" : "failed" })
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const scope = useMemo<OrgScope | null>(
    () =>
      state.kind === "ready"
        ? { org: state.org, isAdmin: isOrgAdminRole(state.org.myRole), reload: () => void load() }
        : null,
    [state, load],
  )

  if (state.kind === "loading") return null
  if (state.kind === "denied" || state.kind === "failed") {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted px-6">
        <div className="max-w-md space-y-3 rounded-lg border border-border bg-background p-8 text-center text-sm text-muted-foreground">
          {state.kind === "denied" ? (
            <p>{ORG_DENIED_TEXT}</p>
          ) : (
            <>
              <p>Не удалось открыть федерацию.</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Повторить
              </Button>
            </>
          )}
          <Link href="/workspaces" className="block font-medium text-foreground underline underline-offset-4">
            К списку клубов
          </Link>
        </div>
      </div>
    )
  }
  return <OrgScopeProvider value={scope}>{children}</OrgScopeProvider>
}
