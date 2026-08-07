import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { HELP_TOPICS, helpTopic } from "@/lib/silverfang/help";

/**
 * The point of these: a paw whose topic id does not exist renders nothing, which
 * looks broken and teaches people to stop hovering. That failure is silent, so it
 * gets a test rather than a code review.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Every `topic="..."` passed to a PawTip anywhere in the app. */
function referencedTopics(): { topic: string; file: string }[] {
  const found: { topic: string; file: string }[] = [];
  for (const file of walk("src/app")) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("PawTip")) continue;
    for (const match of source.matchAll(/<PawTip[^>]*topic="([^"]+)"/g)) {
      found.push({ topic: match[1]!, file });
    }
  }
  return found;
}

describe("help topics", () => {
  it("has a topic for every paw in the app", () => {
    const missing = referencedTopics().filter((r) => !helpTopic(r.topic));
    expect(
      missing.map((m) => `${m.topic} (${m.file})`),
      "a PawTip referencing an unknown topic renders nothing",
    ).toEqual([]);
  });

  it("is actually placed on the SilverFang pages", () => {
    // Guards the other direction: the copy existing but never being shown.
    const topics = referencedTopics();
    expect(topics.length).toBeGreaterThan(10);
  });

  it("gives every topic a title and a body", () => {
    for (const [id, topic] of Object.entries(HELP_TOPICS)) {
      expect(topic.title, id).toBeTruthy();
      expect(topic.body.length, id).toBeGreaterThan(40);
    }
  });

  it("keeps the body short enough to be a hover, not a manual", () => {
    for (const [id, topic] of Object.entries(HELP_TOPICS)) {
      expect(topic.body.length, `${id} body is too long for a tooltip`).toBeLessThan(420);
      if (topic.todo) {
        expect(topic.todo.length, `${id} todo is too long`).toBeLessThan(300);
      }
    }
  });

  it("returns null for an unknown topic rather than throwing", () => {
    expect(helpTopic("nope")).toBeNull();
    expect(helpTopic("")).toBeNull();
  });
});
