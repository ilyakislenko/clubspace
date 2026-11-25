"use client"

import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"
import { Button } from "@clubspace/ui-kit/ui"
import { signOut } from "../../../shared/api/client"
import { fetchMe } from "../../../shared/api/me"
import {
  listMyOrganizations,
  type MyOrganization,
} from "../../../shared/api/organizations"
import {
  fetchWorkspaces,
  isAdminWorkspace,
  type WorkspaceSummary,
} from "../../../shared/api/workspaces"
import { workspaceTypeLabel } from "../../../shared/lib/workspace-type"
import {
  clearActiveWorkspaceId,
  setActiveWorkspaceId,
} from "../../../shared/workspace/storage"
import { CreateClubLink } from "../../../features/billing/CreateClubLink"
import { orgRoleLabel } from "../../../features/org/org-view"
import { pickerLanding } from "../../../features/org/picker-landing"

export default function WorkspacesPage() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [studentOnlyWorkspaces, setStudentOnlyWorkspaces] = useState<
    WorkspaceSummary[]
  >([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  // Federations whose team this account is on (`GET orgs/mine`).
  const [organizations, setOrganizations] = useState<MyOrganization[]>([])

  useEffect(() => {
    let isMounted = true

    const loadWorkspaces = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // `me` comes along because platform power is a property of the
        // account, not of a membership — the workspace list can't reveal it.
        const [data, me, orgs] = await Promise.all([
          fetchWorkspaces(),
          fetchMe(),
          listMyOrganizations(),
        ])
        if (!isMounted) {
          return
        }

        const adminScoped = data.filter(isAdminWorkspace)
        const studentScoped = data.filter((w) => !isAdminWorkspace(w))

        // A platform admin typically has no memberships at all, which used to
        // dead-end them on the "у тебя нет клубов" notice — the one account
        // that can administer everything had nowhere to go. Send them to the
        // console instead, and never auto-dive into a single club: they are
        // operating the platform, not running that club. One admin club (or
        // one federation and no club) opens straight away.
        const landing = pickerLanding({
          isSuperAdmin: me.isSuperAdmin,
          adminClubIds: adminScoped.map((w) => w.workspaceId),
          organizationIds: orgs.map((o) => o.id),
        })
        setIsPlatformAdmin(me.isSuperAdmin)
        if (landing.kind === "platform") {
          router.replace("/platform")
          return
        }
        if (landing.kind === "club") {
          setActiveWorkspaceId(landing.workspaceId)
          router.replace(`/workspace/${landing.workspaceId}`)
          return
        }
        if (landing.kind === "org") {
          router.replace(`/org/${landing.organizationId}`)
          return
        }

        setWorkspaces(adminScoped)
        setStudentOnlyWorkspaces(studentScoped)
        setOrganizations(orgs)
      } catch {
        if (isMounted) {
          setError("Не удалось загрузить клубы. Попробуйте ещё раз.")
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
            <h1 className="text-2xl font-semibold">
              {organizations.length > 0 ? "Выберите клуб или федерацию" : "Выберите клуб"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {organizations.length > 0
                ? "Выберите, чем хотите управлять."
                : "Выберите клуб, которым хотите управлять."}
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
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : workspaces.length === 0 && organizations.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-medium">Доступ в админку только у тренеров и администраторов</div>
              <p className="mt-1 text-xs leading-relaxed">
                {studentOnlyWorkspaces.length > 0
                  ? `Вы числитесь учеником в клубах: ${studentOnlyWorkspaces.length}. Откройте мобильное приложение, чтобы смотреть курсы и тренироваться.`
                  : "У этого аккаунта нет ни одного клуба, где вы администратор или тренер. Если нужен доступ — попросите главного тренера повысить вашу роль."}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              Выйти и войти под другим аккаунтом
            </Button>
            <CreateClubLink text="Хотите вести свой клуб?" />
          </div>
        ) : (
          <div className="space-y-6">
            {workspaces.length > 0 && (
              <section className="space-y-2">
                {organizations.length > 0 && (
                  <h2 className="text-sm font-medium text-muted-foreground">Клубы</h2>
                )}
                <ul className="divide-y divide-border overflow-hidden rounded-md border">
                  {workspaces.map((workspace) => (
                    <li key={workspace.workspaceId}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-muted/50"
                        onClick={() => handleSelect(workspace)}
                      >
                        <span className="space-y-1">
                          <span className="block text-base font-medium">{workspace.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {workspace.key} · {workspaceTypeLabel(workspace.type)}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {organizations.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-medium text-muted-foreground">Федерации</h2>
                <ul className="divide-y divide-border overflow-hidden rounded-md border">
                  {organizations.map((org) => (
                    <li key={org.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-muted/50"
                        onClick={() => router.push(`/org/${org.id}`)}
                      >
                        <span className="space-y-1">
                          <span className="block text-base font-medium">{org.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {orgRoleLabel(org.role, vocabularyForWorkspaceType(org.type))}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
