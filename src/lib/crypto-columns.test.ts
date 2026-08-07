import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { ENCRYPTED_COLUMNS } from "@/lib/crypto-columns";

/**
 * Checked against Prisma's own schema metadata, which needs no database.
 *
 * This exists because the registry addresses models and columns by string, so a
 * typo or a renamed field compiles cleanly and only shows up in production — as a
 * column silently left behind on a retired key, or as the rotation page failing to
 * load. Both have happened.
 */

const models = Prisma.dmmf.datamodel.models;

function field(modelDelegate: string, column: string) {
  // Delegate names are the model name with a lowercase first letter.
  const modelName = modelDelegate.charAt(0).toUpperCase() + modelDelegate.slice(1);
  const model = models.find((m) => m.name === modelName);
  expect(model, `no such model: ${modelName}`).toBeDefined();
  const f = model!.fields.find((x) => x.name === column);
  expect(f, `no such column: ${modelName}.${column}`).toBeDefined();
  return f!;
}

describe("encrypted-column registry", () => {
  it.each(ENCRYPTED_COLUMNS.map((c) => [`${c.model}.${c.column}`, c] as const))(
    "%s exists and is a string column",
    (_label, entry) => {
      const f = field(entry.model, entry.column);
      // Ciphertext is stored as text. A non-string column would mean the
      // encrypted value is being written somewhere it cannot round-trip.
      expect(f.type).toBe("String");
      expect(f.isList).toBe(false);
    },
  );

  it("addresses a model that exposes an id, since rotation updates by id", () => {
    for (const entry of ENCRYPTED_COLUMNS) {
      expect(() => field(entry.model, "id")).not.toThrow();
    }
  });

  it("includes required columns, so the scan must not filter on `not: null`", () => {
    // The reason rotationStatus reads unfiltered. Prisma rejects
    // `{ column: { not: null } }` on a required field with "Argument `not` must
    // not be null", failing the whole query — which took the Security & SSO page
    // down. If this ever becomes empty, the filter is still not worth restoring,
    // but the comment explaining its absence would need revisiting.
    const required = ENCRYPTED_COLUMNS.filter((c) => field(c.model, c.column).isRequired);
    expect(required.length).toBeGreaterThan(0);
  });

  it("lists every column once", () => {
    const keys = ENCRYPTED_COLUMNS.map((c) => `${c.model}.${c.column}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("derives lookup columns that exist on the same model", () => {
    for (const entry of ENCRYPTED_COLUMNS) {
      if (!entry.derived) continue;
      // Derived keys are written in the same update as the rotated value, so a
      // name that does not exist would throw mid-rotation.
      for (const key of Object.keys(entry.derived("someone@example.com"))) {
        expect(() => field(entry.model, key)).not.toThrow();
      }
    }
  });
});
