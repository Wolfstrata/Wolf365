/**
 * Keeping the app out of search engines and AI training corpora.
 *
 * Wolf365 holds client billing data, contact detail and ticket contents. None of it
 * should ever appear in a search result, an AI answer, or a cache — and "we require
 * a login" is not sufficient on its own: a crawler can still index the login page,
 * confirm the tenant exists, and archive URL structure that names clients.
 *
 * Three layers, because any one of them alone is weak:
 *   1. robots.txt — a request, honoured only by the well-behaved
 *   2. X-Robots-Tag on every response — the directive that actually binds the major
 *      engines, and unlike a <meta> tag it covers non-HTML responses too
 *   3. an outright 403 for known crawlers — the part that does not rely on consent
 *
 * DELIBERATELY A CURATED LIST, not /bot/i. A blanket match on "bot" would also
 * reject uptime monitors, Slack and Teams link unfurlers, and Vercel's own probes —
 * and silently breaking your monitoring is a worse outcome than a crawler seeing a
 * login page it has been told not to index. Extend the list rather than widening
 * the pattern.
 */

/**
 * User-agent tokens belonging to search indexers and AI/data crawlers.
 *
 * Lowercased; matched as substrings, which is how user-agent detection has to work
 * because every crawler embeds its token in a longer string.
 */
const CRAWLER_TOKENS: string[] = [
  // Search engines
  "googlebot",
  "google-extended",
  "storebot-google",
  "bingbot",
  "adidxbot",
  "msnbot",
  "slurp", // Yahoo
  "duckduckbot",
  "baiduspider",
  "yandexbot",
  "yandex.com/bots",
  "sogou",
  "exabot",
  "seznambot",
  "naver",
  "petalbot", // Huawei
  "applebot",
  // AI / LLM training and retrieval crawlers
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  "claudebot",
  "claude-web",
  "anthropic-ai",
  "perplexitybot",
  "perplexity-user",
  "youbot",
  "ccbot", // Common Crawl — the corpus most models are trained on
  "google-cloudvertexbot",
  "meta-externalagent",
  "meta-externalfetcher",
  "facebookbot",
  "bytespider",
  "amazonbot",
  "cohere-ai",
  "diffbot",
  "omgili",
  "timpibot",
  "imagesiftbot",
  "img2dataset",
  // SEO / archival crawlers that would happily catalogue the URL structure
  "ahrefsbot",
  "semrushbot",
  "mj12bot",
  "dotbot",
  "rogerbot",
  "screaming frog",
  "ia_archiver",
  "archive.org_bot",
  "zoominfobot",
  "dataforseobot",
  "barkrowler",
  "serpstatbot",
];

/**
 * True when the user agent belongs to a crawler that should be refused outright.
 *
 * An absent or empty user agent is NOT treated as a crawler. Plenty of legitimate
 * traffic omits it — health checks, some corporate proxies, curl in a support
 * session — and refusing all of it to catch a crawler that could trivially set any
 * string anyway trades real breakage for no real protection.
 */
export function isCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_TOKENS.some((token) => ua.includes(token));
}

/**
 * The X-Robots-Tag value sent on every response.
 *
 * `noindex, nofollow` covers indexing and link-following. The rest closes the
 * secondary leaks people forget: `noarchive`/`nocache` stop a cached copy being
 * served after the page is gone, `nosnippet` stops content appearing as a preview
 * even without a click-through, and `noimageindex` keeps client logos and
 * screenshots out of image search.
 */
export const ROBOTS_TAG =
  "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, nocache";

/** Body for a refused crawler. Deliberately says nothing about the application. */
export const CRAWLER_REFUSAL_BODY =
  "This application is private and is not available for indexing.\n";
