"use client"

import { useState } from "react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import { PendingInvitationsPanel } from "../users/PendingInvitationsPanel"
import { AddDependentForm } from "./AddDependentForm"
import { ClubCodeSection } from "./ClubCodeSection"
import { InviteMemberForm } from "./InviteMemberForm"

// «Ученики → Пригласить»: every way into the club in one side panel — the club
// code with its QR and poster (all staff), an invitation by e-mail, a child
// profile and the invitations still waiting to be accepted (sport leads).
// `onChanged` reloads the roster after someone was added.
export function InviteSheet({
  workspaceId,
  open,
  onOpenChange,
  canManageMembers,
  canAdmin,
  onChanged,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  canManageMembers: boolean
  canAdmin: boolean
  onChanged: () => void
}) {
  // Bumped after an invite so «Ожидают принятия» reloads.
  const [invitesKey, setInvitesKey] = useState(0)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Пригласить в клуб</SheetTitle>
          <SheetDescription className="sr-only">
            Код клуба, QR-код и приглашение по e-mail
          </SheetDescription>
        </SheetHeader>

        <ClubCodeSection
          workspaceId={workspaceId}
          canRotateCode={canManageMembers}
          canSetAutoApprove={canAdmin}
        />

        {canManageMembers && (
          <>
            <hr className="border-border" />
            <InviteMemberForm
              workspaceId={workspaceId}
              canInviteStaff={canAdmin}
              onInvited={() => {
                setInvitesKey((k) => k + 1)
                onChanged()
              }}
            />
            <AddDependentForm workspaceId={workspaceId} onAdded={onChanged} />
            <PendingInvitationsPanel
              workspaceId={workspaceId}
              refreshKey={invitesKey}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
