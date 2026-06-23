"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import {
  proposeClientMatches,
  proposeSkuMatches,
  confirmClientMatch,
  rejectClientMatch,
  setProductMappingStatus,
  materializeClients,
} from "@/lib/mapping/service";

export async function autoMatchClientsAction(): Promise<void> {
  const user = await requirePermission("mappings:propose");
  // Create a Client for every synced customer (merging QBO↔TD by name), then
  // surface any remaining fuzzy near-matches as proposals for review.
  await materializeClients({ id: user.id, email: user.email });
  await proposeClientMatches({ id: user.id, email: user.email });
  revalidatePath("/mappings");
  revalidatePath("/clients");
}

export async function autoMatchSkusAction(): Promise<void> {
  const user = await requirePermission("mappings:propose");
  await proposeSkuMatches({ id: user.id, email: user.email });
  revalidatePath("/mappings");
}

export async function confirmClientAction(formData: FormData): Promise<void> {
  const user = await requirePermission("mappings:approve");
  await confirmClientMatch(String(formData.get("id")), {
    id: user.id,
    email: user.email,
  });
  revalidatePath("/mappings");
}

export async function rejectClientAction(formData: FormData): Promise<void> {
  const user = await requirePermission("mappings:approve");
  await rejectClientMatch(String(formData.get("id")), {
    id: user.id,
    email: user.email,
  });
  revalidatePath("/mappings");
}

export async function confirmSkuAction(formData: FormData): Promise<void> {
  const user = await requirePermission("mappings:approve");
  await setProductMappingStatus(String(formData.get("sku")), "CONFIRMED", {
    id: user.id,
    email: user.email,
  });
  revalidatePath("/mappings");
}

export async function rejectSkuAction(formData: FormData): Promise<void> {
  const user = await requirePermission("mappings:approve");
  await setProductMappingStatus(String(formData.get("sku")), "REJECTED", {
    id: user.id,
    email: user.email,
  });
  revalidatePath("/mappings");
}
