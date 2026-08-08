import { describe, it, expect } from "vitest";
import { DOC_SECTIONS, docSectionIds } from "@/lib/silverfang/docs";

/**
 * The docs are data, so the shape can be asserted rather than trusted. An empty
 * heading or a duplicate anchor is the kind of thing nobody notices until a
 * contents link goes to the wrong place.
 */
describe("SilverFang docs", () => {
  it("gives every section an id, a title and a summary", () => {
    for (const section of DOC_SECTIONS) {
      expect(section.id, JSON.stringify(section.title)).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(section.title.trim()).not.toBe("");
      expect(section.summary.trim()).not.toBe("");
    }
  });

  it("has unique anchors", () => {
    const ids = docSectionIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every section some body", () => {
    for (const section of DOC_SECTIONS) {
      expect(section.blocks.length, section.id).toBeGreaterThan(0);
    }
  });

  it("has no empty blocks", () => {
    for (const section of DOC_SECTIONS) {
      for (const block of section.blocks) {
        const filled =
          (block.p?.trim() ?? "") !== "" ||
          (block.h?.trim() ?? "") !== "" ||
          (block.note?.trim() ?? "") !== "" ||
          (block.list?.length ?? 0) > 0;
        expect(filled, `${section.id} has an empty block`).toBe(true);
      }
    }
  });

  it("has no empty list items", () => {
    for (const section of DOC_SECTIONS) {
      for (const block of section.blocks) {
        for (const item of block.list ?? []) {
          expect(item.trim(), section.id).not.toBe("");
        }
      }
    }
  });

  it("covers the subjects a new technician has to be told about", () => {
    // Not a style check: each of these is a behaviour that generates a question
    // when it is undocumented.
    const ids = docSectionIds();
    for (const required of ["boards", "tickets", "time", "agreements", "email", "setup"]) {
      expect(ids, `missing the ${required} section`).toContain(required);
    }
  });

  it("states the two behaviours people are most often surprised by", () => {
    const all = JSON.stringify(DOC_SECTIONS).toLowerCase();
    // Block time is never auto-selected, and an empty authorised-tech list means
    // everyone. Both are deliberate and both look like bugs if undocumented.
    expect(all).toContain("block time is never chosen automatically");
    expect(all).toContain("an empty list means everyone");
  });
});
