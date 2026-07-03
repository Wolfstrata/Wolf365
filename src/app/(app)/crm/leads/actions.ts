"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "DISQUALIFIED",
  "CONVERTED",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Update a lead's working status. */
export async function setLeadStatusAction(id: string, status: string): Promise<void> {
  const actor = await requirePermission("crm:write");
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) return;
  const lead = await prisma.lead.update({
    where: { id },
    data: { status },
    select: { fullName: true, company: true, email: true },
  });
  await audit({
    action: "LEAD_UPDATED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `lead:${id}`,
    metadata: {
      lead: lead.fullName ?? lead.email ?? lead.company ?? id,
      status,
    },
  });
  revalidatePath("/crm/leads");
}
