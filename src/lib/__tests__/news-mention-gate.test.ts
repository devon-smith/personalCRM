import { describe, it, expect } from "vitest";
import {
  articleMentionsAffiliation,
  buildAffiliationTokens,
  type ContactAffiliations,
} from "@/lib/research/news-mention-gate";

const EMPTY: ContactAffiliations = {
  company: null,
  role: null,
  scholarlyInstitution: null,
  tags: [],
  expertiseAreas: [],
};

function withCompany(company: string): ContactAffiliations {
  return { ...EMPTY, company };
}

describe("buildAffiliationTokens", () => {
  it("returns empty when nothing is set", () => {
    expect(buildAffiliationTokens(EMPTY)).toEqual([]);
  });

  it("includes the whole-phrase token when distinctive", () => {
    expect(buildAffiliationTokens(withCompany("OpenEvidence"))).toContain(
      "openevidence",
    );
  });

  it("splits multi-word phrases into sub-tokens", () => {
    const tokens = buildAffiliationTokens(withCompany("Stanford GSB"));
    expect(tokens).toContain("stanford gsb");
    expect(tokens).toContain("stanford");
    expect(tokens).toContain("gsb");
  });

  it("filters out stop-words", () => {
    const tokens = buildAffiliationTokens(
      withCompany("Acme Inc. Holdings"),
    );
    expect(tokens).toContain("acme");
    expect(tokens).not.toContain("inc");
    expect(tokens).not.toContain("holdings");
  });

  it("filters out role filler like 'CEO' and 'engineer'", () => {
    const tokens = buildAffiliationTokens({
      ...EMPTY,
      role: "CEO Engineer Director",
    });
    expect(tokens).not.toContain("ceo");
    expect(tokens).not.toContain("engineer");
    expect(tokens).not.toContain("director");
  });

  it("filters out tokens shorter than 3 chars (e.g. 'AI' from 'X.AI')", () => {
    const tokens = buildAffiliationTokens(withCompany("X.AI"));
    expect(tokens.every((t) => t.length >= 3)).toBe(true);
    // "AI" (2 chars) must not appear; "x.ai" whole-phrase is OK
    // because length is 4.
    expect(tokens).not.toContain("ai");
  });

  it("keeps 3-char acronyms (GSB, MIT, NIH)", () => {
    expect(buildAffiliationTokens(withCompany("MIT"))).toContain("mit");
    expect(
      buildAffiliationTokens({ ...EMPTY, tags: ["NIH grantee"] }),
    ).toContain("nih");
  });

  it("rejects pure-numeric phrases", () => {
    const tokens = buildAffiliationTokens({
      ...EMPTY,
      tags: ["12345", "2024"],
    });
    expect(tokens).not.toContain("12345");
    expect(tokens).not.toContain("2024");
  });

  it("pulls tokens from scholarlyInstitution + tags + expertiseAreas", () => {
    const tokens = buildAffiliationTokens({
      company: null,
      role: null,
      scholarlyInstitution: "Massachusetts Institute of Technology",
      tags: ["humor research"],
      expertiseAreas: ["behavioral economics", "marketing"],
    });
    expect(tokens).toContain("massachusetts");
    expect(tokens).toContain("technology");
    expect(tokens).toContain("humor research");
    expect(tokens).toContain("behavioral economics");
    expect(tokens).toContain("marketing");
  });

  it("dedupes tokens that overlap across sources", () => {
    const tokens = buildAffiliationTokens({
      company: "Anthropic",
      role: null,
      scholarlyInstitution: null,
      tags: ["Anthropic"],
      expertiseAreas: ["anthropic safety research"],
    });
    const occurrences = tokens.filter((t) => t === "anthropic").length;
    expect(occurrences).toBe(1);
  });
});

describe("articleMentionsAffiliation", () => {
  it("passes when title mentions the company", () => {
    const result = articleMentionsAffiliation(withCompany("Anthropic"), {
      title: "Anthropic releases Claude 4.7",
      description: null,
    });
    expect(result.passes).toBe(true);
    expect(result.matchedToken).toBe("anthropic");
  });

  it("passes when only the description mentions a token (case-insensitive)", () => {
    const result = articleMentionsAffiliation(withCompany("OpenEvidence"), {
      title: "Latest AI in healthcare",
      description: "Co-founder of OPENEVIDENCE discusses the shift",
    });
    expect(result.passes).toBe(true);
    expect(result.matchedToken).toBe("openevidence");
  });

  it("fails for pure name-collision noise (the actual bug)", () => {
    // The false positive Jennifer flagged: contact "Toby" has
    // company "Big Studio". The Brave hit is for a different Toby.
    const result = articleMentionsAffiliation(
      withCompany("Big Studio"),
      {
        title: "Toby Smith - Top podcast episodes",
        description: "Listen to the wiki of Toby Smith's podcast career.",
      },
    );
    expect(result.passes).toBe(false);
    expect(result.matchedToken).toBeNull();
  });

  it("passes when an expertise area matches", () => {
    const result = articleMentionsAffiliation(
      {
        ...EMPTY,
        expertiseAreas: ["behavioral economics"],
      },
      {
        title: "New findings in behavioral economics research",
        description: null,
      },
    );
    expect(result.passes).toBe(true);
  });

  it("matches sub-words from multi-word affiliations", () => {
    // "Stanford GSB" should match articles mentioning just "Stanford".
    const result = articleMentionsAffiliation(
      withCompany("Stanford GSB"),
      { title: "Stanford launches new design lab", description: null },
    );
    expect(result.passes).toBe(true);
    expect(result.matchedToken).toBe("stanford");
  });

  it("does NOT match on generic stop-words shared with the contact", () => {
    // Contact's role is "Director of Research" — the gate must NOT
    // pass on articles that mention "director" or "research" alone.
    const result = articleMentionsAffiliation(
      { ...EMPTY, role: "Director of Research" },
      { title: "Top 10 directors in research science", description: null },
    );
    expect(result.passes).toBe(false);
  });

  it("rejects when contact has no affiliations at all", () => {
    // Conservative default: nothing to verify against = don't surface.
    const result = articleMentionsAffiliation(EMPTY, {
      title: "Some article",
      description: "About anything",
    });
    expect(result.passes).toBe(false);
    expect(result.tokensConsidered).toEqual([]);
  });

  it("returns the full token list considered for debug logging", () => {
    const result = articleMentionsAffiliation(
      {
        company: "Anthropic",
        role: null,
        scholarlyInstitution: "Stanford",
        tags: [],
        expertiseAreas: [],
      },
      { title: "Unrelated", description: null },
    );
    expect(result.passes).toBe(false);
    expect(result.tokensConsidered).toContain("anthropic");
    expect(result.tokensConsidered).toContain("stanford");
  });

  it("handles empty description without crashing", () => {
    const result = articleMentionsAffiliation(withCompany("Anthropic"), {
      title: "About Anthropic",
      description: null,
    });
    expect(result.passes).toBe(true);
  });
});
