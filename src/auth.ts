import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getBootstrapAdmins } from "@/env";
import { isDomainAllowed, resolveSso } from "@/lib/auth/sso";

/**
 * Auth.js (NextAuth v5) configuration.
 *
 * - Provider is built dynamically from the admin-configured Entra SSO settings
 *   (or first-run env fallback). If SSO is not configured, no provider is
 *   offered and the sign-in page explains how to bootstrap it.
 * - Database session strategy => secure, HTTP-only, signed session cookies with
 *   server-side revocation. Cookies are forced `secure` in production.
 * - Domain allowlist is enforced in `signIn`. Role is derived from bootstrap
 *   admin list and Entra group→role mappings in the `signIn` event.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const sso = await resolveSso();
  const bootstrapAdmins = getBootstrapAdmins();

  const providers = sso
    ? [
        MicrosoftEntraID({
          clientId: sso.clientId,
          clientSecret: sso.clientSecret,
          issuer: `https://login.microsoftonline.com/${sso.tenantId}/v2.0`,
          // Request group claims so we can map Entra groups to roles when the
          // app registration is configured to emit them.
          authorization: { params: { scope: "openid profile email" } },
        }),
      ]
    : [];

  return {
    adapter: PrismaAdapter(prisma),
    session: { strategy: "database", maxAge: 8 * 60 * 60 }, // 8h sessions
    providers,
    pages: { signIn: "/signin" },
    useSecureCookies: process.env.NODE_ENV === "production",
    trustHost: true,
    callbacks: {
      // Enforce the domain allowlist and account status before linking.
      async signIn({ user }) {
        if (!sso) return false;
        if (!isDomainAllowed(user.email, sso.allowedDomains)) {
          return false;
        }
        // Block users an administrator has disabled (existing accounts only;
        // brand-new sign-ins have no record yet and are allowed in as REVIEWER).
        if (user.email) {
          const existing = await prisma.user.findUnique({
            where: { email: user.email.toLowerCase() },
            select: { disabled: true },
          });
          if (existing?.disabled) return false;
        }
        return true;
      },
      // Surface role + id on the session (database strategy passes `user`).
      async session({ session, user }) {
        if (session.user) {
          session.user.id = user.id;
          session.user.role = (user as { role?: Role }).role ?? "REVIEWER";
          session.user.timezone =
            (user as { timezone?: string | null }).timezone ?? null;
        }
        return session;
      },
    },
    events: {
      // Derive and persist the user's role on each sign-in, capture the Entra
      // object id, and write a LOGIN audit entry.
      async signIn({ user, profile }) {
        if (!user.email || !user.id) return;

        const email = user.email.toLowerCase();
        const groups = Array.isArray(
          (profile as { groups?: unknown[] })?.groups,
        )
          ? ((profile as { groups: string[] }).groups ?? [])
          : [];
        const oid =
          (profile as { oid?: string })?.oid ??
          (profile as { sub?: string })?.sub ??
          null;

        // Role derivation (least privilege):
        // - Bootstrap admins are always ADMINISTRATOR.
        // - When group→role mappings are configured, role is derived strictly
        //   from current group membership, defaulting to REVIEWER if no group
        //   matches. This DOWNGRADES users who lose an elevated group, instead
        //   of letting stale privileges persist.
        // - When no group mappings exist, roles are managed manually in
        //   Admin → Users and are left untouched here.
        let role: Role | null = null;
        if (bootstrapAdmins.includes(email)) {
          role = "ADMINISTRATOR";
        } else if (sso && Object.keys(sso.groupRoleMappings).length > 0) {
          role = "REVIEWER";
          for (const g of groups) {
            const mapped = sso.groupRoleMappings[g];
            if (mapped) {
              role = mapped;
              break;
            }
          }
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            ...(role ? { role } : {}),
            ...(oid ? { entraOid: oid } : {}),
          },
        });

        await audit({
          action: "LOGIN",
          actorId: user.id,
          actorEmail: email,
          metadata: { source: sso?.source ?? "unknown" },
        });
      },
    },
  };
});
