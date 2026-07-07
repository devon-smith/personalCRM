import { describe, it, expect } from "vitest";
import {
  classifyLocation,
  evaluateSubnationMatch,
  evaluateGenericMatch,
} from "@/lib/search/location";

// Re-derive the England config through the public classifier so the
// tests exercise the same object the search path uses.
function englandConfig() {
  const q = classifyLocation("England");
  if (q.kind !== "subnation") throw new Error("expected subnation");
  return q.config;
}

describe("classifyLocation (M0.x.19)", () => {
  it("recognizes UK sub-nations", () => {
    expect(classifyLocation("England").kind).toBe("subnation");
    expect(classifyLocation("scotland").kind).toBe("subnation");
    expect(classifyLocation("  WALES ").kind).toBe("subnation");
    expect(classifyLocation("Northern Ireland").kind).toBe("subnation");
  });

  it("recognizes country aliases", () => {
    const uk = classifyLocation("UK");
    expect(uk.kind).toBe("country");
    const usa = classifyLocation("usa");
    expect(usa.kind).toBe("country");
  });

  it("treats a plain city as generic", () => {
    const q = classifyLocation("Austin");
    expect(q.kind).toBe("generic");
    if (q.kind === "generic") expect(q.normalized).toBe("austin");
  });
});

describe("evaluateSubnationMatch — England confidence (M0.x.19)", () => {
  const cfg = englandConfig();

  it("confirms an explicit state = England", () => {
    const v = evaluateSubnationMatch(
      { city: null, state: "England", country: "United Kingdom" },
      cfg,
    );
    expect(v).toEqual({ confidence: "confirmed", matchedOn: "state" });
  });

  it("confirms via an English city with no country recorded", () => {
    const v = evaluateSubnationMatch(
      { city: "London", state: null, country: null },
      cfg,
    );
    expect(v).toEqual({ confidence: "confirmed", matchedOn: "city" });
  });

  it("confirms an English city when country is UK", () => {
    const v = evaluateSubnationMatch(
      { city: "Bath", state: "England", country: "United Kingdom" },
      cfg,
    );
    expect(v?.confidence).toBe("confirmed");
  });

  it("marks UK-country-only rows as region_unknown", () => {
    const v = evaluateSubnationMatch(
      { city: null, state: null, country: "United Kingdom" },
      cfg,
    );
    expect(v).toEqual({ confidence: "region_unknown", matchedOn: "country" });
    // "GB" variant too.
    expect(
      evaluateSubnationMatch({ city: null, state: null, country: "GB" }, cfg)
        ?.confidence,
    ).toBe("region_unknown");
  });

  it("EXCLUDES a sibling region by state (Scotland)", () => {
    expect(
      evaluateSubnationMatch(
        { city: null, state: "Scotland", country: "United Kingdom" },
        cfg,
      ),
    ).toBeNull();
  });

  it("EXCLUDES Glasgow even when the state doesn't say 'Scotland'", () => {
    // Real case: Jimmy Owens — state "Glasgow City", country "United
    // Kingdom". The sibling-city guard is what catches this.
    expect(
      evaluateSubnationMatch(
        { city: "Glasgow", state: "Glasgow City", country: "United Kingdom" },
        cfg,
      ),
    ).toBeNull();
  });

  it("EXCLUDES Edinburgh/Scotland (the American Express row)", () => {
    expect(
      evaluateSubnationMatch(
        { city: "Edinburgh", state: "Scotland", country: "GB" },
        cfg,
      ),
    ).toBeNull();
  });

  it("EXCLUDES London, Ontario (same-name foreign city)", () => {
    expect(
      evaluateSubnationMatch(
        { city: "London", state: "Ontario", country: "Canada" },
        cfg,
      ),
    ).toBeNull();
  });

  it("EXCLUDES a non-UK, non-matching row entirely", () => {
    expect(
      evaluateSubnationMatch(
        { city: "Paris", state: null, country: "France" },
        cfg,
      ),
    ).toBeNull();
  });

  it("confirms via an English county in the state field", () => {
    const v = evaluateSubnationMatch(
      { city: null, state: "Oxfordshire", country: "United Kingdom" },
      cfg,
    );
    expect(v).toEqual({ confidence: "confirmed", matchedOn: "state" });
  });

  // ── M0.x.19.1: real false positives caught against live data ──

  it("EXCLUDES New Hampshire, USA (substring-collided with 'Hampshire')", () => {
    // Dean Kamen / Ellie Kyung — state "New Hampshire" was matching the
    // English county fragment "hampshire". The foreign-subdivision guard
    // must exclude it even if the country is null.
    expect(
      evaluateSubnationMatch(
        { city: "Manchester", state: "New Hampshire", country: null },
        cfg,
      ),
    ).toBeNull();
    expect(
      evaluateSubnationMatch(
        { city: null, state: "New Hampshire", country: null },
        cfg,
      ),
    ).toBeNull();
  });

  it("EXCLUDES Cambridge / Massachusetts with a NULL country", () => {
    // Dan Ariely et al. — English-city 'Cambridge' + null country slipped
    // through the city branch; the state 'Massachusetts' must veto it.
    expect(
      evaluateSubnationMatch(
        { city: "Cambridge", state: "Massachusetts", country: null },
        cfg,
      ),
    ).toBeNull();
  });

  it("still preserves the county 'Hampshire' (England) as confirmed", () => {
    // The fix must not throw out the legit English county.
    const v = evaluateSubnationMatch(
      { city: null, state: "Hampshire", country: "United Kingdom" },
      cfg,
    );
    expect(v?.confidence).toBe("confirmed");
  });

  it("still confirms London with no state/country (legit UK default)", () => {
    // The guard keys on foreign STATE values, so a bare English city with
    // no other signal is still included (Albert Reynaud case).
    const v = evaluateSubnationMatch(
      { city: "London", state: null, country: null },
      cfg,
    );
    expect(v?.confidence).toBe("confirmed");
  });
});

describe("evaluateSubnationMatch — Scotland (sibling symmetry)", () => {
  it("confirms Glasgow when the query IS Scotland", () => {
    const q = classifyLocation("Scotland");
    if (q.kind !== "subnation") throw new Error("expected subnation");
    const v = evaluateSubnationMatch(
      { city: "Glasgow", state: "Glasgow City", country: "United Kingdom" },
      q.config,
    );
    expect(v?.confidence).toBe("confirmed");
  });

  it("excludes London when the query is Scotland", () => {
    const q = classifyLocation("Scotland");
    if (q.kind !== "subnation") throw new Error("expected subnation");
    expect(
      evaluateSubnationMatch(
        { city: "London", state: "England", country: "United Kingdom" },
        q.config,
      ),
    ).toBeNull();
  });
});

describe("evaluateGenericMatch (M0.x.19)", () => {
  it("matches a country alias (UK) on the country field", () => {
    const q = classifyLocation("United Kingdom");
    const v = evaluateGenericMatch(
      { city: "London", state: "England", country: "United Kingdom" },
      q,
    );
    expect(v).toEqual({ confidence: "confirmed", matchedOn: "country" });
  });

  it("matches a plain city exactly, not by substring", () => {
    const q = classifyLocation("York");
    // exact match on York
    expect(
      evaluateGenericMatch({ city: "York", state: null, country: "United Kingdom" }, q)
        ?.matchedOn,
    ).toBe("city");
    // should NOT match "New York" via substring
    expect(
      evaluateGenericMatch({ city: "New York", state: null, country: "USA" }, q),
    ).toBeNull();
  });
});
