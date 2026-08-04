import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    CreatePlatformWorkspaceFeature,
    CreatePlatformWorkspaceFeatureResponse,
} from './create-platform-workspace.feature'
import {
    isValidWorkspaceKey,
    nextAvailableKey,
    normalizeEmail,
    slugifyWorkspaceKey,
} from './platform-utils'
import { serializePlatformWorkspace } from './schemas'

@Feature(CreatePlatformWorkspaceFeature)
export class CreatePlatformWorkspaceHandler
    implements
        IFeatureHandler<
            CreatePlatformWorkspaceFeature,
            CreatePlatformWorkspaceFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: CreatePlatformWorkspaceFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const { name, type, timezone } = f.payload
        const ownerEmail = normalizeEmail(f.payload.ownerEmail)
        const key = await this.resolveKey(name, f.payload.key)

        // Roles are seeded at boot (BootstrapSeedService.setupRoles) and
        // lowercased on the way in. If it is missing the platform is not
        // initialised, and creating an owner with no role would leave them
        // unable to administer the club they just received.
        const adminRole = await this.prisma.role.findUnique({
            where: { name: 'admin' },
            select: { id: true },
        })
        if (!adminRole) {
            throw new BadRequestError({
                message:
                    'The "admin" role is missing — the platform has not finished bootstrapping',
            })
        }

        const existingOwner = await this.prisma.user.findUnique({
            where: { email: ownerEmail },
            select: { id: true, email: true, firstname: true, lastname: true },
        })

        const result = await this.prisma.$transaction(async (tx) => {
            // No password: sign-in is email-OTP (see send-auth-code), so the
            // owner can request a code for this address straight away. Setting
            // a password here would only create a credential nobody was told.
            const owner =
                existingOwner ??
                (await tx.user.create({
                    data: {
                        email: ownerEmail,
                        status: 'ACTIVE',
                        language: 'RU',
                    },
                    select: {
                        id: true,
                        email: true,
                        firstname: true,
                        lastname: true,
                    },
                }))

            const workspace = await tx.workspace.create({
                data: {
                    key,
                    name,
                    type,
                    ownerId: owner.id,
                    isActive: true,
                    ...(timezone ? { timezone } : {}),
                },
                select: {
                    id: true,
                    key: true,
                    name: true,
                    type: true,
                    isActive: true,
                    timezone: true,
                    createdAt: true,
                },
            })

            // The owner gets a membership row on purpose, and this is the
            // subtle bit. RbacService bypasses membership for the owner, so
            // permissions would work without it — but get-my-workspaces (how
            // BOTH the admin app and the mobile app discover workspaces) reads
            // memberships. Without this row the new owner signs in and sees an
            // empty list with no way into the club they were just given.
            await tx.workspaceMember.create({
                data: {
                    userId: owner.id,
                    workspaceId: workspace.id,
                    roleId: adminRole.id,
                    status: 'ACTIVE',
                },
            })

            return { workspace, owner }
        })

        return {
            workspace: serializePlatformWorkspace(
                result.workspace,
                result.owner,
                1,
            ),
            ownerCreated: existingOwner === null,
        }
    }

    // An explicit key is taken at face value (and must be free); a derived one
    // is suffixed past collisions, so "create another Gracie Barra" doesn't
    // make the admin invent a key by hand.
    private async resolveKey(
        name: string,
        requestedKey?: string,
    ): Promise<string> {
        const explicit = requestedKey?.trim()

        if (explicit) {
            if (!isValidWorkspaceKey(explicit)) {
                throw new BadRequestError({
                    message:
                        'Key must be 2-50 characters of lowercase latin letters, digits, "-" or "_"',
                })
            }
            const taken = await this.prisma.workspace.findUnique({
                where: { key: explicit },
                select: { id: true },
            })
            if (taken) {
                throw new BadRequestError({
                    message: `Workspace key "${explicit}" is already taken`,
                })
            }
            return explicit
        }

        const base = slugifyWorkspaceKey(name)
        if (!isValidWorkspaceKey(base)) {
            throw new BadRequestError({
                message:
                    'Could not derive a key from this name — pass an explicit key',
            })
        }

        const siblings = await this.prisma.workspace.findMany({
            where: { key: { startsWith: base } },
            select: { key: true },
        })
        return nextAvailableKey(
            base,
            siblings.map((s) => s.key),
        )
    }
}
