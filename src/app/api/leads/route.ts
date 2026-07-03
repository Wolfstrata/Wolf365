import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEnv } from "@/env";
import { safeEqual } from "@/lib/crypto";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lead ingestion endpoint for external workflows (e.g. ZoomInfo).
 *
 * POST /api/leads with `Authorization: Bearer <WOLF365_LEADS_TOKEN>` and a JSON
 * body that is a single lead object or an array of them. Field names are mapped
 * defensively across common export shapes. Leads are deduped by externalId
 * first, then by email. Returns { ok, created, updated, skipped }.
 */

const MAX_LEADS_PER_REQUEST = 500;

function pickStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function mapLead(o: Record<string, unknown>) {
  const firstName = pickStr(o, ["firstName", "first_name", "firstname"]);
  const lastName = pickStr(o, ["lastName", "last_name", "lastname"]);
  const fullName =
    pickStr(o, ["fullName", "full_name", "name", "contactName"]) ??
    ([firstName, lastName].filter(Boolean).join(" ") || null);
  return {
    externalId: pickStr(o, [
      "externalId",
      "external_id",
      "zoomInfoId",
      "zoominfo_id",
      "personId",
      "person_id",
      "id",
    ]),
    firstName,
    lastName,
    fullName,
    company: pickStr(o, ["company", "companyName", "company_name", "organization", "accountName"]),
    title: pickStr(o, ["title", "jobTitle", "job_title", "position"]),
    email: pickStr(o, ["email", "emailAddress", "email_address", "workEmail", "work_email"])?.toLowerCase() ?? null,
    phone: pickStr(o, ["phone", "phoneNumber", "phone_number", "directPhone", "direct_phone", "mobilePhone", "mobile_phone"]),
    website: pickStr(o, ["website", "companyWebsite", "company_website", "domain", "companyDomain", "company_domain"]),
    source: pickStr(o, ["source"]) ?? "zoominfo",
    notes: pickStr(o, ["notes", "note", "comments"]),
    raw: o as Prisma.InputJsonValue,
  };
}

export async function POST(request: Request) {
  const env = getEnv();
  if (!env.WOLF365_LEADS_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "Lead ingestion is not configured (WOLF365_LEADS_TOKEN)" },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (!safeEqual(authHeader, `Bearer ${env.WOLF365_LEADS_TOKEN}`)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const rl = await rateLimit(`leads:${clientIp(request)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const items = Array.isArray(payload) ? payload : [payload];
  if (items.length > MAX_LEADS_PER_REQUEST) {
    return NextResponse.json(
      { ok: false, error: `Too many leads in one request (max ${MAX_LEADS_PER_REQUEST})` },
      { status: 413 },
    );
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        skipped += 1;
        continue;
      }
      const lead = mapLead(item as Record<string, unknown>);
      // Unusable without at least a person/company identifier.
      if (!lead.externalId && !lead.email && !lead.fullName && !lead.company) {
        skipped += 1;
        continue;
      }

      if (lead.externalId) {
        const existing = await prisma.lead.findUnique({
          where: { externalId: lead.externalId },
          select: { id: true },
        });
        if (existing) {
          await prisma.lead.update({ where: { id: existing.id }, data: lead });
          updated += 1;
        } else {
          await prisma.lead.create({ data: lead });
          created += 1;
        }
      } else if (lead.email) {
        const existing = await prisma.lead.findFirst({
          where: { email: lead.email },
          select: { id: true },
        });
        if (existing) {
          await prisma.lead.update({ where: { id: existing.id }, data: lead });
          updated += 1;
        } else {
          await prisma.lead.create({ data: lead });
          created += 1;
        }
      } else {
        await prisma.lead.create({ data: lead });
        created += 1;
      }
    }

    await audit({
      action: "LEADS_IMPORTED",
      actorId: null,
      actorEmail: "leads-api",
      target: "leads:ingest",
      metadata: { received: items.length, created, updated, skipped },
    });

    return NextResponse.json({ ok: true, created, updated, skipped });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(err), created, updated, skipped },
      { status: 500 },
    );
  }
}
