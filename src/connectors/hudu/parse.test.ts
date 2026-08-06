import { describe, expect, it } from "vitest";
import {
  huduLink,
  isSecretField,
  joinAddress,
  parseArticle,
  parseAsset,
  parseCompany,
  safeFields,
} from "./parse";

const BASE = "https://acme.huducloud.com";

describe("isSecretField", () => {
  it("flags Hudu's confidential field types", () => {
    for (const t of [
      "Password",
      "confidential",
      "ConfidentialText",
      "confidential_text",
      "EmbedPassword",
      "asset_password",
    ]) {
      expect(isSecretField({ label: "Something", field_type: t })).toBe(true);
    }
  });

  it("flags a field Hudu marks confidential regardless of its label", () => {
    expect(isSecretField({ label: "Notes", confidential: true })).toBe(true);
    expect(isSecretField({ label: "Notes", is_confidential: true })).toBe(true);
  });

  it("flags labels that read like a secret", () => {
    for (const label of [
      "Password",
      "Admin Password",
      "domain passwd",
      "Passphrase",
      "Shared Secret",
      "API Key",
      "apikey (prod)",
      "Bearer Token",
      "Private Key",
      "License Key",
      "BitLocker Recovery Key",
      "Door PIN",
      "MFA seed",
      "Bank account",
      "IBAN",
    ]) {
      expect(isSecretField({ label, field_type: "text" }), label).toBe(true);
    }
  });

  it("leaves ordinary facts alone", () => {
    for (const label of ["Hostname", "IP Address", "Operating System", "Warranty expiry", "Notes"]) {
      expect(isSecretField({ label, field_type: "text" }), label).toBe(false);
    }
  });

  it("does not flag an unlabelled field on label grounds alone", () => {
    expect(isSecretField({ field_type: "text" })).toBe(false);
  });
});

describe("safeFields", () => {
  it("keeps ordinary fields and counts what it withholds", () => {
    const { fields, redacted } = safeFields({
      fields: [
        { label: "Hostname", value: "DC01" },
        { label: "Local admin password", value: "hunter2" },
        { label: "IP Address", value: "10.0.0.5" },
        { label: "Notes", value: "x", confidential: true },
      ],
    });
    expect(fields).toEqual([
      { label: "Hostname", value: "DC01" },
      { label: "IP Address", value: "10.0.0.5" },
    ]);
    expect(redacted).toBe(2);
    // The whole point: no withheld value appears anywhere in the output.
    expect(JSON.stringify(fields)).not.toContain("hunter2");
  });

  it("reads custom_fields when that is the shape returned", () => {
    const { fields } = safeFields({ custom_fields: [{ name: "Site", content: "HQ" }] });
    expect(fields).toEqual([{ label: "Site", value: "HQ" }]);
  });

  it("withholds long values, which are documentation bodies rather than facts", () => {
    const { fields, redacted } = safeFields({
      fields: [{ label: "Runbook", value: "x".repeat(501) }],
    });
    expect(fields).toEqual([]);
    expect(redacted).toBe(1);
  });

  it("skips fields with no label or no value without counting them as withheld", () => {
    const { fields, redacted } = safeFields({
      fields: [{ label: "Empty", value: "" }, { value: "orphan" }],
    });
    expect(fields).toEqual([]);
    expect(redacted).toBe(0);
  });

  it("returns nothing for a record with no fields at all", () => {
    expect(safeFields({})).toEqual({ fields: [], redacted: 0 });
  });
});

describe("joinAddress", () => {
  it("joins the parts Hudu keeps separately", () => {
    expect(
      joinAddress({
        address_line_1: "1 Main St",
        city: "Calgary",
        state: "AB",
        zip: "T2P 1A1",
        country_name: "Canada",
      }),
    ).toBe("1 Main St, Calgary, AB, T2P 1A1, Canada");
  });

  it("is null when Hudu holds no address", () => {
    expect(joinAddress({})).toBeNull();
    expect(joinAddress({ city: "   " })).toBeNull();
  });
});

describe("huduLink", () => {
  it("prefers the url Hudu returns", () => {
    expect(huduLink({ id: 7, url: "https://acme.huducloud.com/a/7-dc01" }, BASE, "a")).toBe(
      "https://acme.huducloud.com/a/7-dc01",
    );
  });

  it("builds one from the base url when Hudu gives none", () => {
    expect(huduLink({ id: 7 }, BASE, "a")).toBe("https://acme.huducloud.com/a/7");
    expect(huduLink({ id: 7 }, `${BASE}/`, "a")).toBe("https://acme.huducloud.com/a/7");
  });

  it("is null rather than a guess when there is no id or base", () => {
    expect(huduLink({}, BASE, "a")).toBeNull();
    expect(huduLink({ id: 7 }, "", "a")).toBeNull();
  });
});

describe("parseCompany", () => {
  it("maps the fields SilverFang shows", () => {
    expect(
      parseCompany(
        {
          id: 12,
          name: "Acme Ltd",
          nickname: "Acme",
          company_type: "Client",
          address_line_1: "1 Main St",
          city: "Calgary",
          phone_number: "403-555-0100",
          website: "https://acme.example",
          id_number: "AC-1",
          archived: false,
        },
        BASE,
      ),
    ).toEqual({
      huduId: "12",
      name: "Acme Ltd",
      nickname: "Acme",
      companyType: "Client",
      address: "1 Main St, Calgary",
      phone: "403-555-0100",
      website: "https://acme.example",
      idNumber: "AC-1",
      huduUrl: "https://acme.huducloud.com/c/12",
      archived: false,
    });
  });

  it("is null without an id or a name", () => {
    expect(parseCompany({ name: "No id" }, BASE)).toBeNull();
    expect(parseCompany({ id: 1 }, BASE)).toBeNull();
  });
});

describe("parseAsset", () => {
  it("maps an asset and withholds its secrets", () => {
    const a = parseAsset(
      {
        id: 90,
        company_id: 12,
        name: "DC01",
        asset_type: "Server",
        primary_serial: "SN-1",
        primary_model: "R740",
        primary_manufacturer: "Dell",
        primary_mail: "ops@acme.example",
        archived: false,
        updated_at: "2026-07-01T10:00:00Z",
        fields: [
          { label: "Hostname", value: "dc01.acme.local" },
          { label: "Admin password", value: "hunter2" },
        ],
      },
      BASE,
    );
    expect(a?.huduId).toBe("90");
    expect(a?.companyHuduId).toBe("12");
    expect(a?.assetLayout).toBe("Server");
    expect(a?.serial).toBe("SN-1");
    expect(a?.fields).toEqual([{ label: "Hostname", value: "dc01.acme.local" }]);
    expect(a?.redactedFieldCount).toBe(1);
    expect(a?.huduUpdatedAt?.toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(JSON.stringify(a)).not.toContain("hunter2");
  });

  it("is null for an asset with no company, which could not be attributed", () => {
    expect(parseAsset({ id: 90, name: "Orphan" }, BASE)).toBeNull();
  });

  it("tolerates a missing updated_at", () => {
    expect(parseAsset({ id: 1, company_id: 2, name: "X" }, BASE)?.huduUpdatedAt).toBeNull();
  });
});

describe("parseArticle", () => {
  it("maps a company article to its company", () => {
    const a = parseArticle(
      { id: 5, company_id: 12, name: "Onboarding", folder_name: "HR", archived: false },
      BASE,
    );
    expect(a).toMatchObject({
      huduId: "5",
      companyHuduId: "12",
      name: "Onboarding",
      folder: "HR",
      global: false,
      huduUrl: "https://acme.huducloud.com/kba/5",
    });
  });

  it("marks an article with no company as global", () => {
    const a = parseArticle({ id: 6, name: "Standard build" }, BASE);
    expect(a?.global).toBe(true);
    expect(a?.companyHuduId).toBeNull();
  });

  it("never carries the article body", () => {
    const a = parseArticle({ id: 7, name: "Runbook", content: "root password: hunter2" }, BASE);
    expect(JSON.stringify(a)).not.toContain("hunter2");
  });

  it("is null without an id or a name", () => {
    expect(parseArticle({ id: 8 }, BASE)).toBeNull();
  });
});
