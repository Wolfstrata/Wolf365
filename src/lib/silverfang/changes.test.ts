import { describe, it, expect } from "vitest";
import {
  auditableFields,
  describeChanges,
  diffFields,
  normalizeValue,
} from "./changes";

describe("normalizeValue", () => {
  it("treats null, undefined and blank strings as not set", () => {
    for (const v of [null, undefined, "", "   ", "\n"]) {
      expect(normalizeValue(v)).toBeNull();
    }
  });

  it("renders booleans and numbers stably", () => {
    expect(normalizeValue(true)).toBe("true");
    expect(normalizeValue(false)).toBe("false");
    expect(normalizeValue(0)).toBe("0");
    expect(normalizeValue(12.5)).toBe("12.5");
  });

  it("drops non-finite numbers rather than recording Infinity", () => {
    expect(normalizeValue(Number.NaN)).toBeNull();
    expect(normalizeValue(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("renders dates as instants", () => {
    expect(normalizeValue(new Date("2026-08-06T12:00:00.000Z"))).toBe(
      "2026-08-06T12:00:00.000Z",
    );
  });

  it("uses a wrapper's own toString, as Prisma Decimal does", () => {
    const decimalLike = { toString: () => "1234.5600" };
    expect(normalizeValue(decimalLike)).toBe("1234.5600");
  });

  it("falls back to JSON for plain objects", () => {
    expect(normalizeValue({ a: 1 })).toBe('{"a":1}');
  });

  it("keeps meaningful strings untouched", () => {
    expect(normalizeValue("jane@example.com")).toBe("jane@example.com");
  });
});

describe("diffFields", () => {
  it("reports only fields that changed, in the order given", () => {
    expect(
      diffFields(
        { email: "a@x.com", title: "Admin", phone: "1" },
        { email: "b@x.com", title: "Admin", phone: "2" },
        ["email", "title", "phone"],
      ),
    ).toEqual([
      { field: "email", oldValue: "a@x.com", newValue: "b@x.com" },
      { field: "phone", oldValue: "1", newValue: "2" },
    ]);
  });

  it("ignores fields not named, so bookkeeping never pollutes the trail", () => {
    expect(
      diffFields({ email: "a@x.com", updatedAt: new Date(0) }, { email: "a@x.com", updatedAt: new Date(1) }, [
        "email",
      ]),
    ).toEqual([]);
  });

  it("does not record a change between the different flavours of empty", () => {
    expect(diffFields({ phone: null }, { phone: "" }, ["phone"])).toEqual([]);
    expect(diffFields({ phone: "" }, { phone: null }, ["phone"])).toEqual([]);
    expect(diffFields({ phone: "  " }, { phone: null }, ["phone"])).toEqual([]);
  });

  it("records setting and clearing a value", () => {
    expect(diffFields({ phone: null }, { phone: "204-555-0100" }, ["phone"])).toEqual([
      { field: "phone", oldValue: null, newValue: "204-555-0100" },
    ]);
    expect(diffFields({ phone: "204-555-0100" }, { phone: null }, ["phone"])).toEqual([
      { field: "phone", oldValue: "204-555-0100", newValue: null },
    ]);
  });

  it("records a boolean flip, including to false", () => {
    expect(
      diffFields({ allowClientEmail: true }, { allowClientEmail: false }, ["allowClientEmail"]),
    ).toEqual([{ field: "allowClientEmail", oldValue: "true", newValue: "false" }]);
  });

  it("treats a missing before-record as creation of every set field", () => {
    expect(diffFields(null, { email: "a@x.com", phone: null }, ["email", "phone"])).toEqual([
      { field: "email", oldValue: null, newValue: "a@x.com" },
    ]);
  });

  it("compares dates by instant, not identity", () => {
    const a = new Date("2026-08-06T12:00:00Z");
    const b = new Date("2026-08-06T12:00:00Z");
    expect(diffFields({ at: a }, { at: b }, ["at"])).toEqual([]);
  });
});

describe("auditableFields", () => {
  it("excludes identity and bookkeeping columns", () => {
    expect(
      auditableFields({
        id: "c1",
        email: "a@x.com",
        createdAt: new Date(),
        updatedAt: new Date(),
        locallyModifiedAt: new Date(),
        title: "Admin",
      }),
    ).toEqual(["email", "title"]);
  });
});

describe("describeChanges", () => {
  it("reads naturally for small change sets", () => {
    expect(describeChanges([])).toBe("no changes");
    expect(describeChanges([{ field: "email", oldValue: null, newValue: "a" }])).toBe("email");
    expect(
      describeChanges([
        { field: "email", oldValue: null, newValue: "a" },
        { field: "title", oldValue: null, newValue: "b" },
      ]),
    ).toBe("email and title");
  });

  it("summarizes larger ones", () => {
    const changes = ["a", "b", "c", "d"].map((field) => ({
      field,
      oldValue: null,
      newValue: "x",
    }));
    expect(describeChanges(changes)).toBe("a, b and 2 more");
  });
});
