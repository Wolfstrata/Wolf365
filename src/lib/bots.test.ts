import { describe, it, expect } from "vitest";
import { isCrawler, ROBOTS_TAG } from "@/lib/bots";

describe("isCrawler", () => {
  it("catches the major search engines", () => {
    expect(
      isCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    ).toBe(true);
    expect(isCrawler("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toBe(
      true,
    );
    expect(isCrawler("Mozilla/5.0 (compatible; YandexBot/3.0)")).toBe(true);
    expect(isCrawler("DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)")).toBe(true);
  });

  it("catches AI and training crawlers", () => {
    // The ones that would put client billing data into a model or an AI answer.
    expect(isCrawler("Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)")).toBe(true);
    expect(isCrawler("Mozilla/5.0 (compatible; ClaudeBot/1.0)")).toBe(true);
    expect(isCrawler("CCBot/2.0 (https://commoncrawl.org/faq/)")).toBe(true);
    expect(isCrawler("Mozilla/5.0 (compatible; PerplexityBot/1.0)")).toBe(true);
    expect(isCrawler("meta-externalagent/1.1")).toBe(true);
    expect(isCrawler("Bytespider")).toBe(true);
  });

  it("catches SEO and archival crawlers", () => {
    expect(isCrawler("Mozilla/5.0 (compatible; AhrefsBot/7.0)")).toBe(true);
    expect(isCrawler("Mozilla/5.0 (compatible; SemrushBot/7~bl)")).toBe(true);
    expect(isCrawler("ia_archiver")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isCrawler("GOOGLEBOT")).toBe(true);
    expect(isCrawler("gptbot")).toBe(true);
  });

  it("leaves real browsers alone", () => {
    expect(
      isCrawler(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(
      isCrawler(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      ),
    ).toBe(false);
  });

  it("does not reject an absent user agent", () => {
    // Health checks, corporate proxies and curl in a support session all omit it.
    // Refusing them to catch a crawler that could set any string anyway trades real
    // breakage for no real protection.
    expect(isCrawler(null)).toBe(false);
    expect(isCrawler(undefined)).toBe(false);
    expect(isCrawler("")).toBe(false);
  });

  it("does not reject monitoring or link unfurlers", () => {
    // The reason this is a curated list and not /bot/i: silently breaking uptime
    // monitoring is a worse outcome than a crawler seeing a login page.
    expect(isCrawler("Better Uptime Bot")).toBe(false);
    expect(isCrawler("Pingdom.com_bot_version_1.4")).toBe(false);
    expect(isCrawler("UptimeRobot/2.0")).toBe(false);
    expect(isCrawler("Slackbot-LinkExpanding 1.0")).toBe(false);
    expect(isCrawler("Mozilla/5.0 (compatible; vercel-screenshot/1.0)")).toBe(false);
    expect(isCrawler("curl/8.4.0")).toBe(false);
  });
});

describe("ROBOTS_TAG", () => {
  it("closes the secondary leaks, not just indexing", () => {
    // noindex alone still permits a cached copy, a text snippet, and image search.
    for (const directive of [
      "noindex",
      "nofollow",
      "noarchive",
      "nosnippet",
      "noimageindex",
    ]) {
      expect(ROBOTS_TAG).toContain(directive);
    }
  });
});
