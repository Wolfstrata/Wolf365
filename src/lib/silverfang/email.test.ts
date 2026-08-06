import { describe, it, expect } from "vitest";
import {
  addressDomain,
  buildOutboundSubject,
  buildReferences,
  escapeHtml,
  formatTicketTag,
  htmlToPlainText,
  isAutoSubmitted,
  isPublicEmailDomain,
  normalizeAddress,
  outboundAddress,
  ownAddresses,
  parseAddressList,
  parseTicketNumber,
  pollFloor,
  referencedMessageIds,
  renderTemplate,
  sameAddress,
  stripQuotedReply,
  stripSubjectDecorations,
  summaryFromSubject,
  textToHtml,
  withSignature,
} from "./email";

describe("ticket tagging", () => {
  it("formats the tag", () => {
    expect(formatTicketTag(1042)).toBe("[SF-1042]");
  });

  it("parses a tag through stacked reply prefixes", () => {
    expect(parseTicketNumber("Re: Fwd: RE: [SF-1042] Printer down")).toBe(1042);
  });

  it("tolerates spacing and case variations", () => {
    expect(parseTicketNumber("[ sf - 77 ] anything")).toBe(77);
    expect(parseTicketNumber("ticket sf-9 please")).toBe(9);
  });

  it("returns null when there is no tag", () => {
    expect(parseTicketNumber("Printer down")).toBeNull();
    expect(parseTicketNumber("")).toBeNull();
    expect(parseTicketNumber(null)).toBeNull();
  });

  it("ignores a tag with no digits", () => {
    expect(parseTicketNumber("[SF-] nothing")).toBeNull();
  });
});

describe("stripSubjectDecorations", () => {
  it("removes stacked prefixes and the tag", () => {
    expect(stripSubjectDecorations("Re: Fwd: [SF-1042] Printer down")).toBe("Printer down");
  });

  it("handles numbered Outlook prefixes", () => {
    expect(stripSubjectDecorations("RE[2]: Printer down")).toBe("Printer down");
  });

  it("handles non-English prefixes", () => {
    expect(stripSubjectDecorations("AW: Drucker kaputt")).toBe("Drucker kaputt");
  });

  it("collapses the whitespace a removed tag leaves behind", () => {
    expect(stripSubjectDecorations("Printer  [SF-5]  down")).toBe("Printer down");
  });

  it("returns empty for nothing usable", () => {
    expect(stripSubjectDecorations("  ")).toBe("");
    expect(stripSubjectDecorations(undefined)).toBe("");
  });
});

describe("buildOutboundSubject", () => {
  it("tags a fresh message", () => {
    expect(buildOutboundSubject(12, "Printer down")).toBe("[SF-12] Printer down");
  });

  it("never double-tags when the summary already carries one", () => {
    expect(buildOutboundSubject(12, "[SF-12] Printer down")).toBe("[SF-12] Printer down");
  });

  it("prefixes Re: for replies", () => {
    expect(buildOutboundSubject(12, "Printer down", { reply: true })).toBe(
      "Re: [SF-12] Printer down",
    );
  });

  it("falls back when the summary is empty", () => {
    expect(buildOutboundSubject(3, "   ")).toBe("[SF-3] (no subject)");
  });
});

describe("summaryFromSubject", () => {
  it("cleans a reply subject into a usable summary", () => {
    expect(summaryFromSubject("Re: [SF-4] Cannot print")).toBe("Cannot print");
  });

  it("falls back for a blank subject", () => {
    expect(summaryFromSubject(null)).toBe("(no subject)");
  });

  it("truncates to the column limit", () => {
    const long = "x".repeat(400);
    const out = summaryFromSubject(long, 300);
    expect(out).toHaveLength(300);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("stripQuotedReply", () => {
  it("cuts at an On … wrote: marker", () => {
    const body = [
      "Thanks, that fixed it.",
      "",
      "On Mon, 4 Aug 2026 at 10:12, Support <support@wolfstrata.com> wrote:",
      "> Have you tried restarting the spooler?",
    ].join("\n");
    expect(stripQuotedReply(body)).toBe("Thanks, that fixed it.");
  });

  it("cuts at an Outlook original-message divider", () => {
    const body = "Still broken.\n\n-----Original Message-----\nFrom: Support";
    expect(stripQuotedReply(body)).toBe("Still broken.");
  });

  it("cuts at a From: header line", () => {
    const body = "Any update?\n\nFrom: Support <support@wolfstrata.com>\nSent: Monday";
    expect(stripQuotedReply(body)).toBe("Any update?");
  });

  it("cuts at the first quoted block after real content", () => {
    expect(stripQuotedReply("Yes please.\n> earlier text")).toBe("Yes please.");
  });

  it("keeps a body that is entirely quoted rather than emptying it", () => {
    // A top-quoting client can start the body with '>' — dropping everything
    // would lose the message, so line 0 is never treated as a cut point.
    expect(stripQuotedReply("> only quoted text")).toBe("> only quoted text");
  });

  it("returns the body untouched when no marker is present", () => {
    expect(stripQuotedReply("Just a plain message.\nSecond line.")).toBe(
      "Just a plain message.\nSecond line.",
    );
  });

  it("normalizes CRLF and collapses blank runs", () => {
    expect(stripQuotedReply("a\r\n\r\n\r\n\r\nb")).toBe("a\n\nb");
  });

  it("handles empty input", () => {
    expect(stripQuotedReply(null)).toBe("");
  });
});

describe("html/text conversion", () => {
  it("escapes HTML metacharacters", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });

  it("converts text to html with breaks", () => {
    expect(textToHtml("a\nb")).toBe("a<br />b");
  });

  it("escapes before adding breaks so injected markup cannot survive", () => {
    expect(textToHtml("<script>x</script>")).toBe("&lt;script&gt;x&lt;/script&gt;");
  });

  it("extracts readable text from html", () => {
    const html = "<div>Hello<br/>there</div><p>Second &amp; last</p>";
    expect(htmlToPlainText(html)).toBe("Hello\nthere\nSecond & last");
  });

  it("drops script and style content", () => {
    expect(htmlToPlainText("<style>p{color:red}</style><p>Hi</p>")).toBe("Hi");
    expect(htmlToPlainText("<script>alert(1)</script><p>Hi</p>")).toBe("Hi");
  });

  it("decodes numeric entities and nbsp", () => {
    expect(htmlToPlainText("<p>caf&#233;&nbsp;time</p>")).toBe("café time");
  });

  it("handles empty input", () => {
    expect(htmlToPlainText(null)).toBe("");
  });
});

describe("addresses", () => {
  it("extracts an angle-bracketed address", () => {
    expect(normalizeAddress('"Jane Doe" <Jane.Doe@Example.COM>')).toBe("jane.doe@example.com");
  });

  it("accepts a bare address and strips mailto:", () => {
    expect(normalizeAddress("mailto:A@B.ca")).toBe("a@b.ca");
  });

  it("rejects non-addresses", () => {
    expect(normalizeAddress("not an address")).toBeNull();
    expect(normalizeAddress("missing@domain")).toBeNull();
    expect(normalizeAddress("")).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
  });

  it("parses and de-duplicates a header list", () => {
    expect(parseAddressList("A@b.ca, Jane <jane@b.ca>; a@B.CA")).toEqual([
      "a@b.ca",
      "jane@b.ca",
    ]);
  });

  it("parses an array form and skips rubbish entries", () => {
    expect(parseAddressList(["x@y.ca", "junk", ""])).toEqual(["x@y.ca"]);
  });

  it("compares case-insensitively", () => {
    expect(sameAddress("A@b.ca", "a@B.ca")).toBe(true);
    expect(sameAddress("a@b.ca", "c@b.ca")).toBe(false);
    expect(sameAddress(null, "a@b.ca")).toBe(false);
  });

  it("extracts the domain", () => {
    expect(addressDomain("Jane <jane@Sub.Example.com>")).toBe("sub.example.com");
    expect(addressDomain("junk")).toBeNull();
  });
});

describe("isPublicEmailDomain", () => {
  it("flags consumer providers so they are never domain-matched to a client", () => {
    expect(isPublicEmailDomain("gmail.com")).toBe(true);
    expect(isPublicEmailDomain("GMAIL.COM")).toBe(true);
    expect(isPublicEmailDomain("shaw.ca")).toBe(true);
  });

  it("passes business domains through", () => {
    expect(isPublicEmailDomain("alairhomes.com")).toBe(false);
    expect(isPublicEmailDomain(null)).toBe(false);
  });
});

describe("threading headers", () => {
  it("puts In-Reply-To first then References newest-first", () => {
    expect(
      referencedMessageIds({
        inReplyTo: "<c@x>",
        references: "<a@x> <b@x> <c@x>",
      }),
    ).toEqual(["<c@x>", "<b@x>", "<a@x>"]);
  });

  it("handles a bare in-reply-to with no references", () => {
    expect(referencedMessageIds({ inReplyTo: "<only@x>" })).toEqual(["<only@x>"]);
  });

  it("returns nothing when both are absent", () => {
    expect(referencedMessageIds({})).toEqual([]);
  });

  it("chains references for a reply", () => {
    expect(buildReferences("<a@x> <b@x>", "<c@x>")).toBe("<a@x> <b@x> <c@x>");
  });

  it("starts a chain from the parent alone", () => {
    expect(buildReferences(null, "<a@x>")).toBe("<a@x>");
  });

  it("does not repeat an id already in the chain", () => {
    expect(buildReferences("<a@x>", "<a@x>")).toBe("<a@x>");
  });

  it("returns null with nothing to chain", () => {
    expect(buildReferences(null, null)).toBeNull();
  });
});

describe("isAutoSubmitted", () => {
  it("detects the Auto-Submitted header", () => {
    expect(isAutoSubmitted({ headers: { "Auto-Submitted": "auto-replied" } })).toBe(true);
  });

  it("treats auto-submitted: no as human mail", () => {
    expect(isAutoSubmitted({ headers: { "auto-submitted": "no" } })).toBe(false);
  });

  it("detects Exchange out-of-office suppression", () => {
    expect(isAutoSubmitted({ headers: { "X-Auto-Response-Suppress": "All" } })).toBe(true);
  });

  it("detects bulk precedence", () => {
    expect(isAutoSubmitted({ headers: { Precedence: "bulk" } })).toBe(true);
  });

  it("detects auto-reply subjects", () => {
    expect(isAutoSubmitted({ subject: "Automatic reply: your request" })).toBe(true);
    expect(isAutoSubmitted({ subject: "Undeliverable: Printer down" })).toBe(true);
  });

  it("passes ordinary mail through", () => {
    expect(isAutoSubmitted({ subject: "Printer down", headers: {} })).toBe(false);
    expect(isAutoSubmitted({})).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("substitutes known placeholders", () => {
    expect(
      renderTemplate("Ticket {{ticket.number}} for {{client.name}}", {
        "ticket.number": 42,
        "client.name": "Alair",
      }),
    ).toBe("Ticket 42 for Alair");
  });

  it("tolerates inner whitespace", () => {
    expect(renderTemplate("{{ ticket.number }}", { "ticket.number": 7 })).toBe("7");
  });

  it("leaves unknown or empty placeholders visible rather than blanking them", () => {
    expect(renderTemplate("Hi {{contact.firstName}}", {})).toBe("Hi {{contact.firstName}}");
    expect(renderTemplate("Hi {{contact.firstName}}", { "contact.firstName": "" })).toBe(
      "Hi {{contact.firstName}}",
    );
  });
});

describe("outboundAddress / ownAddresses", () => {
  it("prefers the reply-as address when set", () => {
    expect(
      outboundAddress({ address: "help@wolfstrata.com", sendAsAddress: "Support <SUPPORT@wolfstrata.com>" }),
    ).toBe("support@wolfstrata.com");
  });

  it("falls back to the polled address when unset or unusable", () => {
    expect(outboundAddress({ address: "help@wolfstrata.com" })).toBe("help@wolfstrata.com");
    expect(outboundAddress({ address: "help@wolfstrata.com", sendAsAddress: "" })).toBe(
      "help@wolfstrata.com",
    );
    expect(outboundAddress({ address: "help@wolfstrata.com", sendAsAddress: "junk" })).toBe(
      "help@wolfstrata.com",
    );
  });

  it("treats both addresses as our own for loop detection", () => {
    expect(
      ownAddresses({ address: "help@wolfstrata.com", sendAsAddress: "support@wolfstrata.com" }),
    ).toEqual(["help@wolfstrata.com", "support@wolfstrata.com"]);
  });

  it("de-duplicates when both addresses are the same", () => {
    expect(
      ownAddresses({ address: "help@wolfstrata.com", sendAsAddress: "HELP@wolfstrata.com" }),
    ).toEqual(["help@wolfstrata.com"]);
  });

  it("ignores an unusable reply-as address", () => {
    expect(ownAddresses({ address: "help@wolfstrata.com", sendAsAddress: null })).toEqual([
      "help@wolfstrata.com",
    ]);
  });
});

describe("pollFloor", () => {
  const early = new Date("2026-08-01T00:00:00Z");
  const late = new Date("2026-08-06T00:00:00Z");

  it("uses the cutoff on a mailbox that has never been polled", () => {
    expect(pollFloor(null, late)).toEqual(late);
  });

  it("uses the watermark when it is newer than the cutoff", () => {
    expect(pollFloor(late, early)).toEqual(late);
  });

  it("uses the cutoff when it is newer, so raising it skips history", () => {
    expect(pollFloor(early, late)).toEqual(late);
  });

  it("never goes back before what has already been processed", () => {
    // Lowering the cutoff must not re-open the back catalogue.
    expect(pollFloor(late, new Date("2020-01-01T00:00:00Z"))).toEqual(late);
  });

  it("returns null when neither is set (fetch from the beginning)", () => {
    expect(pollFloor(null, null)).toBeNull();
  });
});

describe("withSignature", () => {
  it("appends after a separator", () => {
    expect(withSignature("Thanks", "Wolfstrata Support")).toBe(
      "Thanks\n\n--\nWolfstrata Support",
    );
  });

  it("leaves the body alone when there is no signature", () => {
    expect(withSignature("Thanks", "  ")).toBe("Thanks");
    expect(withSignature("Thanks", null)).toBe("Thanks");
  });
});
