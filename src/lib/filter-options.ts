/**
 * Matching typed text against a list of options.
 *
 * Pure so the behaviour is pinned by tests rather than discovered by typing into
 * the box. The rules matter more than they look:
 *
 *  - **Substring, not prefix.** "penner" has to find "EG Penner Building Centres",
 *    which a prefix match never would. Nobody types a company's legal first word.
 *  - **Space-separated terms, all of which must match, in any order.** "wolf test"
 *    finds "Wolf Test Ltd"; so does "test wolf". Requiring the typed order is how
 *    a search box feels broken.
 *  - **Earlier matches rank higher**, so typing "wolf" puts "Wolf Test" above
 *    "Grey Wolf Holdings" — the thing you are most likely to mean is first, and
 *    Enter picks it.
 */

export interface FilterableOption {
  id: string;
  label: string;
  /** Extra searchable text that is not displayed, e.g. an email address. */
  keywords?: string;
}

/** Lower-cased, whitespace-collapsed haystack for one option. */
function haystack(option: FilterableOption): string {
  return `${option.label} ${option.keywords ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The query split into terms. Empty query → no terms, which matches everything. */
export function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * How well an option matches, or null for no match.
 *
 * Lower is better. The score is the position of the *earliest* term match, so an
 * option whose name starts with what you typed beats one that mentions it later.
 */
export function matchScore(option: FilterableOption, terms: string[]): number | null {
  if (terms.length === 0) return 0;
  const text = haystack(option);
  let best = Number.MAX_SAFE_INTEGER;
  for (const term of terms) {
    const at = text.indexOf(term);
    // Every term must appear. A missing one disqualifies the option outright,
    // which is what makes adding a word narrow the list instead of widening it.
    if (at === -1) return null;
    if (at < best) best = at;
  }
  return best;
}

/**
 * Options matching the query, best first, then alphabetically so the order is
 * stable rather than dependent on the order they arrived in.
 */
export function filterOptions<T extends FilterableOption>(
  options: T[],
  query: string,
  limit = 50,
): T[] {
  const terms = queryTerms(query);
  const scored: { option: T; score: number }[] = [];
  for (const option of options) {
    const score = matchScore(option, terms);
    if (score != null) scored.push({ option, score });
  }
  scored.sort(
    (a, b) => a.score - b.score || a.option.label.localeCompare(b.option.label),
  );
  // Bounded because the client list runs to a couple of thousand and rendering
  // all of them into the DOM on every keystroke is what makes a picker feel slow.
  return scored.slice(0, limit).map((s) => s.option);
}
