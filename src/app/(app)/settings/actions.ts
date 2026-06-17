"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";

export interface SettingsResult {
  ok: boolean;
  message: string;
}

export async function saveTimezoneAction(
  _prev: SettingsResult | null,
  formData: FormData,
): Promise<SettingsResult> {
  const user = await requireUser();
  const tz = String(formData.get("timezone") ?? "").trim();

  // Validate against the runtime's supported IANA zones.
  if (tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      return { ok: false, message: `Unknown timezone: ${tz}` };
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { timezone: tz || null },
  });
  revalidatePath("/settings");
  return {
    ok: true,
    message: tz ? `Timezone set to ${tz}.` : "Timezone cleared (using UTC).",
  };
}
