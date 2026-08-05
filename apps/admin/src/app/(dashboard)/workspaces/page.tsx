"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@clubspace/ui-kit/ui"
import { signOut } from "../../../shared/api/client"
import { fetchMe } from "../../../shared/api/me"
import {
  fetchWorkspaces,
  type WorkspaceSummary,
} from "../../../shared/api/workspaces"
import {
  clearActiveWorkspaceId,
  setActiveWorkspaceId,
} from "../../../shared/workspace/storage"

// Mirrors STAFF_ROLES on the server — anyone with these names has admin
// surface access. 'user' is the mobile-only role and gets bounced.
const ADMIN_ROLE_NAMES = new Set([
  "admin",
  "head_coach",
  "coach",
  "moderator",
])

const isAdminWorkspace = (w: WorkspaceSummary): boolean =>
  w.isOwner || ADMIN_ROLE_NAMES.has(w.roleName)

export default function WorkspacesPage() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [studentOnlyWorkspaces, setStudentOnlyWorkspaces] = useState<
    WorkspaceSummary[]
  >([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)

  useEffect(() => {
    let isMounted = true

    const loadWorkspaces = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // `me` comes along because platform power is a property of the
        // account, not of a membership — the workspace list can't reveal it.
        const [data, me] = await Promise.all([fetchWorkspaces(), fetchMe()])
        if (!isMounted) {
          return
        }

        const adminScoped = data.filter(isAdminWorkspace)
        const studentScoped = data.filter((w) => !isAdminWorkspace(w))

        // A platform admin typically has no memberships at all, which used to
        // dead-end them on the "у тебя нет клубов" notice — the one account
        // that can administer everything had nowhere to go. Send them to the
        // console instead, and never auto-dive into a single club: they are
        // operating the platform, not running that club.
        if (me.isSuperAdmin) {
          setIsPlatformAdmin(true)
          if (adminScoped.length === 0) {
            router.replace("/platform")
            return
          }
          setWorkspaces(adminScoped)
          setStudentOnlyWorkspaces(studentScoped)
          return
        }

        if (adminScoped.length === 1) {
          setActiveWorkspaceId(adminScoped[0].workspaceId)
          router.replace(`/workspace/${adminScoped[0].workspaceId}`)
          return
        }

        setWorkspaces(adminScoped)
        setStudentOnlyWorkspaces(studentScoped)
      } catch {
        if (isMounted) {
          setError("Failed to load workspaces. Please try again.")
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadWorkspaces()

    return () => {
      isMounted = false
    }
  }, [router])

  const handleSelect = (workspace: WorkspaceSummary) => {
    setActiveWorkspaceId(workspace.workspaceId)
    router.push(`/workspace/${workspace.workspaceId}`)
  }

  const handleSignOut = async () => {
    clearActiveWorkspaceId()
    await signOut()
    router.replace("/sign-in")
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted px-6 py-10">
      <div className="w-full max-w-3xl space-y-6 rounded-lg border bg-background p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Select workspace</h1>
            <p className="text-sm text-muted-foreground">
              Choose a workspace you want to manage.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isPlatformAdmin && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => router.push("/platform")}
              >
                Платформа
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              Выйти
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : workspaces.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-medium">Доступ в админку только у тренеров и администраторов</div>
              <p className="mt-1 text-xs leading-relaxed">
                {studentOnlyWorkspaces.length > 0
                  ? `Ты числишься учеником в ${studentOnlyWorkspaces.length} клубе(ах). Учеников учётом занимается тренер — открой мобильное приложение, чтобы смотреть курсы и тренироваться.`
                  : "У этого аккаунта нет ни одного клуба, где ты администратор или тренер. Если нужен доступ — попроси главного тренера повысить твою роль."}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              Выйти и войти под другим аккаунтом
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            {workspaces.map((workspace) => (
              <div
                key={workspace.workspaceId}
                className="flex flex-col items-start justify-between gap-4 rounded-md border p-4 sm:flex-row sm:items-center"
              >
                <div className="space-y-1">
                  <div className="text-base font-medium">{workspace.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {workspace.key} · {workspace.type}
                  </div>
                </div>
                <Button onClick={() => handleSelect(workspace)}>
                  Open workspace
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
