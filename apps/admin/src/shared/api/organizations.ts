import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"
import { cachedRead, invalidateReads } from "./read-cache"

// The federation hub (docs/design/2026-11-26-federation-hub-mvp.md): the org
// console (`orgs/:organizationId/*`, org staff only) and the club side
// (`workspaces/:workspaceId/organizations*`, club admins).

const org = (organizationId: string) => `/orgs/${organizationId}`
const ws = (workspaceId: string) => `/workspaces/${workspaceId}`

// The server answers 404 on every org route while ORGANIZATIONS_ENABLED is
// off; an account then simply has no federation.
const isNotFound = (error: unknown): boolean =>
  (error as { response?: { status?: number } } | null)?.response?.status === 404

// ---- My federations (picker, account menu) ----

export type MyOrganization = ApiTypes.ListMyOrganizationsOutputDtoOutput["data"][number]

// Asked by the picker and every club page's sidebar; the team changes rarely.
const MY_ORGS_TTL_MS = 60_000

export const listMyOrganizations = (): Promise<MyOrganization[]> =>
  cachedRead(
    "orgs:mine",
    async () => {
      try {
        const res = await getApiClient().request<ApiTypes.ListMyOrganizationsOutputDtoOutput>({
          method: "get",
          url: "/orgs/mine",
        })
        return res.data
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
    },
    MY_ORGS_TTL_MS,
  )

// ---- The federation itself ----

export type Organization = ApiTypes.GetOrganizationOutputDtoOutput
export type OrganizationUpdate = ApiTypes.UpdateOrganizationInputDto

export const getOrganization = (p: { organizationId: string }): Promise<Organization> =>
  getApiClient().request<Organization>({ method: "get", url: org(p.organizationId) })

export const updateOrganization = async (p: {
  organizationId: string
  data: OrganizationUpdate
}): Promise<Organization> => {
  const updated = await getApiClient().request<Organization, OrganizationUpdate>({
    method: "patch",
    url: org(p.organizationId),
    data: p.data,
  })
  invalidateReads("orgs:mine")
  return updated
}

export type OrganizationLogoUpload = ApiTypes.CreateOrganizationLogoUploadOutputDtoOutput

export const createOrganizationLogoUpload = (p: {
  organizationId: string
  data: ApiTypes.CreateOrganizationLogoUploadInputDto
}): Promise<OrganizationLogoUpload> =>
  getApiClient().request<OrganizationLogoUpload, ApiTypes.CreateOrganizationLogoUploadInputDto>({
    method: "post",
    url: `${org(p.organizationId)}/logo-upload`,
    data: p.data,
  })

// ---- Clubs ----

export type OrgClubsList = ApiTypes.ListOrganizationClubsOutputDtoOutput
export type OrgClub = OrgClubsList["data"][number]
export type OrgClubsTotals = OrgClubsList["totals"]

export const listOrganizationClubs = (p: { organizationId: string }): Promise<OrgClubsList> =>
  getApiClient().request<OrgClubsList>({ method: "get", url: `${org(p.organizationId)}/clubs` })

export type ClubPreview = ApiTypes.PublicClubOutputDtoOutput

// The invite's preview: the same public lookup a student joins by.
export const findClubByJoinCode = (code: string): Promise<ClubPreview> =>
  getApiClient().request<ClubPreview>({
    method: "get",
    url: `/public/clubs/by-code/${encodeURIComponent(code)}`,
  })

export const inviteClubToOrganization = (p: {
  organizationId: string
  joinCode: string
}): Promise<OrgClub> =>
  getApiClient().request<OrgClub, ApiTypes.InviteClubToOrganizationInputDto>({
    method: "post",
    url: `${org(p.organizationId)}/clubs/invitations`,
    data: { joinCode: p.joinCode },
  })

// Revokes an invitation or excludes an active club.
export const removeClubFromOrganization = (p: { organizationId: string; linkId: string }) =>
  getApiClient().request<{ success: true }, undefined>({
    method: "delete",
    url: `${org(p.organizationId)}/clubs/${p.linkId}`,
  })

// ---- Belt registry ----

export type OrgRegistryPage = ApiTypes.SearchOrganizationRegistryOutputOutput
export type OrgRegistryRow = OrgRegistryPage["data"][number]
export type OrgRegistryQuery = NonNullable<ApiTypes.SearchOrganizationRegistryData["query"]>
export type OrgRegistryPerson = ApiTypes.GetOrganizationRegistryPersonOutputOutput

export const searchOrganizationRegistry = ({
  organizationId,
  ...params
}: { organizationId: string } & OrgRegistryQuery): Promise<OrgRegistryPage> =>
  getApiClient().request<OrgRegistryPage>({
    method: "get",
    url: `${org(organizationId)}/registry`,
    params,
  })

export const getOrganizationRegistryPerson = (p: {
  organizationId: string
  personKey: string
}): Promise<OrgRegistryPerson> =>
  getApiClient().request<OrgRegistryPerson>({
    method: "get",
    url: `${org(p.organizationId)}/registry/${encodeURIComponent(p.personKey)}`,
  })

// ---- Announcements ----

export type OrgAnnouncement = ApiTypes.OrgAnnouncementOutputDtoOutput
export type OrgAnnouncementInput = ApiTypes.CreateOrgAnnouncementInput
export type OrgAnnouncementUpdate = ApiTypes.UpdateOrgAnnouncementInput

export const listOrgAnnouncements = (p: {
  organizationId: string
}): Promise<ApiTypes.ListOrgAnnouncementsOutputOutput> =>
  getApiClient().request<ApiTypes.ListOrgAnnouncementsOutputOutput>({
    method: "get",
    url: `${org(p.organizationId)}/announcements`,
    params: { perPage: 100 },
  })

export const createOrgAnnouncement = (p: {
  organizationId: string
  data: OrgAnnouncementInput
}): Promise<OrgAnnouncement> =>
  getApiClient().request<OrgAnnouncement, OrgAnnouncementInput>({
    method: "post",
    url: `${org(p.organizationId)}/announcements`,
    data: p.data,
  })

export const updateOrgAnnouncement = (p: {
  organizationId: string
  announcementId: string
  data: OrgAnnouncementUpdate
}): Promise<OrgAnnouncement> =>
  getApiClient().request<OrgAnnouncement, OrgAnnouncementUpdate>({
    method: "patch",
    url: `${org(p.organizationId)}/announcements/${p.announcementId}`,
    data: p.data,
  })

export const deleteOrgAnnouncement = (p: { organizationId: string; announcementId: string }) =>
  getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `${org(p.organizationId)}/announcements/${p.announcementId}`,
  })

// ---- Calendar ----

export type OrgEvent = ApiTypes.OrgEventOutputDtoOutput
export type OrgEventInput = ApiTypes.CreateOrgEventInput
export type OrgEventUpdate = ApiTypes.UpdateOrgEventInput
export type OrgEventRegistrations = ApiTypes.ListOrgEventRegistrationsOutputOutput
export type OrgEventRegistration = OrgEventRegistrations["data"][number]

const events = (organizationId: string) => `${org(organizationId)}/events`

export const listOrgEvents = (p: { organizationId: string; includePast?: boolean }): Promise<{ data: OrgEvent[] }> =>
  getApiClient().request<{ data: OrgEvent[] }>({
    method: "get",
    url: events(p.organizationId),
    params: { includePast: p.includePast },
  })

export const createOrgEvent = (p: { organizationId: string; data: OrgEventInput }): Promise<OrgEvent> =>
  getApiClient().request<OrgEvent, OrgEventInput>({ method: "post", url: events(p.organizationId), data: p.data })

export const updateOrgEvent = (p: {
  organizationId: string
  eventId: string
  data: OrgEventUpdate
}): Promise<OrgEvent> =>
  getApiClient().request<OrgEvent, OrgEventUpdate>({
    method: "patch",
    url: `${events(p.organizationId)}/${p.eventId}`,
    data: p.data,
  })

export const deleteOrgEvent = (p: { organizationId: string; eventId: string }) =>
  getApiClient().request<unknown, undefined>({ method: "delete", url: `${events(p.organizationId)}/${p.eventId}` })

export const listOrgEventRegistrations = (p: {
  organizationId: string
  eventId: string
}): Promise<OrgEventRegistrations> =>
  getApiClient().request<OrgEventRegistrations>({
    method: "get",
    url: `${events(p.organizationId)}/${p.eventId}/registrations`,
  })

// ---- Ladder standards ----

export type OrgLadderTemplate = ApiTypes.OrgLadderTemplateOutputDtoOutput
export type OrgTemplateLevel = OrgLadderTemplate["levels"][number]
export type OrgLadderTemplateInput = ApiTypes.CreateOrgLadderTemplateInput
export type OrgLadderTemplateUpdate = ApiTypes.UpdateOrgLadderTemplateInput
export type OrgTemplateLevelInput = ApiTypes.CreateOrgLadderTemplateLevelInput
export type OrgTemplateLevelUpdate = ApiTypes.UpdateOrgLadderTemplateLevelInput

const templates = (organizationId: string) => `${org(organizationId)}/ladder-templates`

export const listOrgLadderTemplates = (p: {
  organizationId: string
  includeInactive?: boolean
}): Promise<{ data: OrgLadderTemplate[] }> =>
  getApiClient().request<{ data: OrgLadderTemplate[] }>({
    method: "get",
    url: templates(p.organizationId),
    params: { includeInactive: p.includeInactive },
  })

export const createOrgLadderTemplate = (p: {
  organizationId: string
  data: OrgLadderTemplateInput
}): Promise<OrgLadderTemplate> =>
  getApiClient().request<OrgLadderTemplate, OrgLadderTemplateInput>({
    method: "post",
    url: templates(p.organizationId),
    data: p.data,
  })

export const updateOrgLadderTemplate = (p: {
  organizationId: string
  templateId: string
  data: OrgLadderTemplateUpdate
}): Promise<OrgLadderTemplate> =>
  getApiClient().request<OrgLadderTemplate, OrgLadderTemplateUpdate>({
    method: "patch",
    url: `${templates(p.organizationId)}/${p.templateId}`,
    data: p.data,
  })

export const deleteOrgLadderTemplate = (p: { organizationId: string; templateId: string }) =>
  getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `${templates(p.organizationId)}/${p.templateId}`,
  })

export const createOrgTemplateLevel = (p: {
  organizationId: string
  templateId: string
  data: OrgTemplateLevelInput
}): Promise<OrgLadderTemplate> =>
  getApiClient().request<OrgLadderTemplate, OrgTemplateLevelInput>({
    method: "post",
    url: `${templates(p.organizationId)}/${p.templateId}/levels`,
    data: p.data,
  })

export const updateOrgTemplateLevel = (p: {
  organizationId: string
  templateId: string
  levelId: string
  data: OrgTemplateLevelUpdate
}): Promise<OrgLadderTemplate> =>
  getApiClient().request<OrgLadderTemplate, OrgTemplateLevelUpdate>({
    method: "patch",
    url: `${templates(p.organizationId)}/${p.templateId}/levels/${p.levelId}`,
    data: p.data,
  })

export const deleteOrgTemplateLevel = (p: {
  organizationId: string
  templateId: string
  levelId: string
}) =>
  getApiClient().request<unknown, undefined>({
    method: "delete",
    url: `${templates(p.organizationId)}/${p.templateId}/levels/${p.levelId}`,
  })

// ---- Team ----

export type OrgMember = ApiTypes.ListOrgMembersOutputDtoOutput["data"][number]
export type OrgMemberInput = ApiTypes.AddOrgMemberInputDto

export const listOrgMembers = (p: { organizationId: string }): Promise<{ data: OrgMember[] }> =>
  getApiClient().request<{ data: OrgMember[] }>({ method: "get", url: `${org(p.organizationId)}/members` })

export const addOrgMember = (p: { organizationId: string; data: OrgMemberInput }): Promise<OrgMember> =>
  getApiClient().request<OrgMember, OrgMemberInput>({
    method: "post",
    url: `${org(p.organizationId)}/members`,
    data: p.data,
  })

export const removeOrgMember = (p: { organizationId: string; userId: string }) =>
  getApiClient().request<{ success: true }, undefined>({
    method: "delete",
    url: `${org(p.organizationId)}/members/${p.userId}`,
  })

// ---- Journal ----

export type OrgAuditPage = ApiTypes.ListOrgAuditEventsOutputDtoOutput

export const listOrgAuditEvents = (p: {
  organizationId: string
  curPage?: number
  perPage?: number
}): Promise<OrgAuditPage> =>
  getApiClient().request<OrgAuditPage>({
    method: "get",
    url: `${org(p.organizationId)}/audit`,
    params: { curPage: p.curPage, perPage: p.perPage },
  })

// ---- Club side: «Настройки → Федерация» ----

export type ClubOrganizationLink = ApiTypes.ListClubOrganizationsOutputDtoOutput["data"][number]
export type OrganizationSharing = ClubOrganizationLink["sharing"]

// Shared in flight: the settings menu and the page ask at once.
export const listClubOrganizations = async (p: { workspaceId: string }): Promise<ClubOrganizationLink[]> =>
  cachedRead(`club-orgs:${p.workspaceId}`, async () => {
    try {
      const res = await getApiClient().request<ApiTypes.ListClubOrganizationsOutputDtoOutput>({
        method: "get",
        url: `${ws(p.workspaceId)}/organizations`,
      })
      return res.data
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  })

export const acceptOrganizationInvite = (p: {
  workspaceId: string
  linkId: string
  sharing: OrganizationSharing
}) =>
  getApiClient().request<ClubOrganizationLink, ApiTypes.AcceptOrganizationInviteInputDto>({
    method: "post",
    url: `${ws(p.workspaceId)}/organizations/${p.linkId}/accept`,
    data: { sharing: p.sharing },
  })

export const declineOrganizationInvite = (p: { workspaceId: string; linkId: string }) =>
  getApiClient().request<ClubOrganizationLink, undefined>({
    method: "post",
    url: `${ws(p.workspaceId)}/organizations/${p.linkId}/decline`,
  })

export const updateOrganizationSharing = (p: {
  workspaceId: string
  linkId: string
  data: ApiTypes.UpdateOrganizationSharingInputDto
}) =>
  getApiClient().request<ClubOrganizationLink, ApiTypes.UpdateOrganizationSharingInputDto>({
    method: "patch",
    url: `${ws(p.workspaceId)}/organizations/${p.linkId}/sharing`,
    data: p.data,
  })

export const leaveOrganization = (p: { workspaceId: string; linkId: string }) =>
  getApiClient().request<ClubOrganizationLink, undefined>({
    method: "post",
    url: `${ws(p.workspaceId)}/organizations/${p.linkId}/leave`,
  })

// ---- Club side: «Пояса → Лестницы» ----

export type AdoptableTemplate = ApiTypes.ListAdoptableLadderTemplatesOutputOutput["data"][number]

// Standards of the federations the club is active in; none while the
// feature is off.
export const listAdoptableLadderTemplates = async (p: { workspaceId: string }): Promise<AdoptableTemplate[]> => {
  try {
    const res = await getApiClient().request<ApiTypes.ListAdoptableLadderTemplatesOutputOutput>({
      method: "get",
      url: `${ws(p.workspaceId)}/organization-ladder-templates`,
    })
    return res.data
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
}

export const createRankLadderFromTemplate = (p: {
  workspaceId: string
  data: ApiTypes.CreateRankLadderFromTemplateInput
}) =>
  getApiClient().request<ApiTypes.CreateRankLadderFromTemplateOutputOutput, ApiTypes.CreateRankLadderFromTemplateInput>({
    method: "post",
    url: `${ws(p.workspaceId)}/rank-ladders/from-template`,
    data: p.data,
  })
