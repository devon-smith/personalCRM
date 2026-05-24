import { describe, it, expect } from "vitest";
import { cleanContactName, inferFromEmail } from "@/lib/contacts/clean-name";

describe("cleanContactName — quote stripping", () => {
  it("strips surrounding ASCII double quotes", () => {
    const r = cleanContactName({ name: '"Marcus Chen"' });
    expect(r.name).toBe("Marcus Chen");
    expect(r.fixes).toContain("quotes");
  });

  it("strips surrounding ASCII single quotes", () => {
    const r = cleanContactName({ name: "'Jane Doe'" });
    expect(r.name).toBe("Jane Doe");
    expect(r.fixes).toContain("quotes");
  });

  it("strips smart quotes", () => {
    const r = cleanContactName({ name: "“Renée García”" });
    expect(r.name).toBe("Renée García");
    expect(r.fixes).toContain("quotes");
  });

  it("does not flag quote fix when no quotes present", () => {
    const r = cleanContactName({ name: "Marcus Chen" });
    expect(r.name).toBe("Marcus Chen");
    expect(r.fixes).not.toContain("quotes");
  });
});

describe("cleanContactName — leading symbols", () => {
  it("strips leading asterisks", () => {
    const r = cleanContactName({ name: "* Sarah Chen" });
    expect(r.name).toBe("Sarah Chen");
    expect(r.fixes).toContain("leading-symbols");
  });

  it("strips leading bullets and arrows", () => {
    expect(cleanContactName({ name: "• Alice" }).name).toBe("Alice");
    expect(cleanContactName({ name: ">> Bob" }).name).toBe("Bob");
    expect(cleanContactName({ name: "- Charlie" }).name).toBe("Charlie");
  });

  it("does not strip letters or digits", () => {
    const r = cleanContactName({ name: "A. Smith" });
    expect(r.name).toBe("A. Smith");
    expect(r.fixes).not.toContain("leading-symbols");
  });
});

describe("cleanContactName — Last, First reversal", () => {
  it("flips Last, First to First Last", () => {
    const r = cleanContactName({ name: "Chen, Marcus" });
    expect(r.name).toBe("Marcus Chen");
    expect(r.fixes).toContain("last-first-reversal");
  });

  it("flips multi-word last names", () => {
    const r = cleanContactName({ name: "Van Der Berg, Anna" });
    expect(r.name).toBe("Anna Van Der Berg");
  });

  it("does not flip when the second half looks like an email", () => {
    const r = cleanContactName({ name: "Chen, marcus@x.com" });
    expect(r.fixes).not.toContain("last-first-reversal");
  });

  it("handles Last, First, Suffix by stripping suffix then reversing", () => {
    const r = cleanContactName({ name: "Chen, Marcus, Jr" });
    expect(r.name).toBe("Marcus Chen");
    expect(r.fixes).toContain("last-first-reversal");
  });

  it("does not flip when the second half is non-name (digits)", () => {
    const r = cleanContactName({ name: "Chen, 12345" });
    expect(r.fixes).not.toContain("last-first-reversal");
  });

  it("does not flip when the second half is an all-caps credential acronym", () => {
    // "Anya Ostry, MCR" must NOT become "MCR Anya Ostry". The credential
    // trailing-strip removes MCR; what stays is just "Anya Ostry".
    const r = cleanContactName({ name: "Anya Ostry, MCR" });
    expect(r.name).toBe("Anya Ostry");
    expect(r.fixes).not.toContain("last-first-reversal");
  });

  it("still flips legitimate Last, First even when last contains punctuation", () => {
    expect(cleanContactName({ name: "O'Connor, Sean" }).name).toBe("Sean O'Connor");
  });
});

describe("cleanContactName — suffix stripping", () => {
  it("strips PhD with comma boundary", () => {
    expect(cleanContactName({ name: "Sarah Chen, PhD" }).name).toBe("Sarah Chen");
  });

  it("strips PhD with whitespace boundary (no comma)", () => {
    expect(cleanContactName({ name: "Sarah Chen PhD" }).name).toBe("Sarah Chen");
  });

  it("strips MBA in mixed case", () => {
    expect(cleanContactName({ name: "Alice Tan, mba" }).name).toBe("Alice Tan");
  });

  it("preserves generational suffix without a comma (part of the name)", () => {
    // Regression: "Joe Schmidt IV" should NOT lose the IV.
    expect(cleanContactName({ name: "Joe Schmidt IV" }).name).toBe("Joe Schmidt IV");
    expect(cleanContactName({ name: "Bob Smith Jr." }).name).toBe("Bob Smith Jr.");
  });

  it("strips generational suffix only with explicit comma", () => {
    expect(cleanContactName({ name: "Bob Smith, Jr." }).name).toBe("Bob Smith");
    expect(cleanContactName({ name: "Cleo Wu, III" }).name).toBe("Cleo Wu");
  });

  it("does not eat names that just happen to end in roman-numeral letters", () => {
    // Regression: "Paradise Hawaii" used to become "Paradise Hawa".
    expect(cleanContactName({ name: "Paradise Hawaii" }).name).toBe("Paradise Hawaii");
    expect(cleanContactName({ name: "David II Patel" }).name).toBe("David II Patel");
  });
});

describe("cleanContactName — email-as-name", () => {
  it("rescues from name field when it's an email", () => {
    const r = cleanContactName({ name: "marcus.chen@stanford.edu" });
    expect(r.name).toBe("Marcus Chen");
    expect(r.fixes).toContain("email-as-name");
  });

  it("uses provided email when name field email is opaque", () => {
    const r = cleanContactName({
      name: "abc123@example.com",
      email: "real.person@example.com",
    });
    expect(r.name).toBe("Real Person");
  });
});

describe("cleanContactName — infer from email when name empty", () => {
  it("infers when name is empty", () => {
    const r = cleanContactName({ name: "", email: "jane.doe@x.com" });
    expect(r.name).toBe("Jane Doe");
    expect(r.fixes).toContain("inferred-from-email");
  });

  it("infers when name is null", () => {
    const r = cleanContactName({ name: null, email: "alice@x.com" });
    expect(r.name).toBe("Alice");
  });

  it("returns null when both name and email are missing", () => {
    const r = cleanContactName({ name: null, email: null });
    expect(r.name).toBeNull();
    expect(r.fixes).toEqual([]);
  });
});

describe("cleanContactName — combined fixes", () => {
  it("applies multiple fixes in one pass", () => {
    const r = cleanContactName({ name: '* "Chen, Marcus", PhD' });
    expect(r.name).toBe("Marcus Chen");
    expect(r.fixes).toEqual(
      expect.arrayContaining(["leading-symbols", "quotes", "last-first-reversal"]),
    );
  });

  it("leaves a clean name untouched and returns no fixes", () => {
    const r = cleanContactName({ name: "Marcus Chen" });
    expect(r.name).toBe("Marcus Chen");
    expect(r.fixes).toEqual([]);
  });

  it("collapses internal whitespace", () => {
    const r = cleanContactName({ name: "Marcus    Chen" });
    expect(r.name).toBe("Marcus Chen");
  });
});

describe("cleanContactName — real-world regressions from dry-run", () => {
  // All ten of these were credential-reversal false positives in the
  // production dry-run. They must either stay unchanged or be cleaned
  // to a sensible name — NEVER reversed into "Credential Name" form.

  it("JD Schramm, Ed.D. → strips Ed.D., never reverses", () => {
    expect(cleanContactName({ name: "JD Schramm, Ed.D." }).name).toBe("JD Schramm");
  });

  it("PhD, MCC Yifat Sharabi-Levine → strips leading credentials", () => {
    expect(
      cleanContactName({ name: "PhD, MCC Yifat Sharabi-Levine" }).name,
    ).toBe("Yifat Sharabi-Levine");
  });

  it("Michele Colucci, Esq. → strips Esq.", () => {
    expect(cleanContactName({ name: "Michele Colucci, Esq." }).name).toBe("Michele Colucci");
  });

  it("Justin V. Graham, MD MS → strips both trailing credentials", () => {
    expect(cleanContactName({ name: "Justin V. Graham, MD MS" }).name).toBe("Justin V. Graham");
  });

  it("Yaman Saleh, M.Sc. → strips dot-credential", () => {
    expect(cleanContactName({ name: "Yaman Saleh, M.Sc." }).name).toBe("Yaman Saleh");
  });

  it("CPCC, PCC Dikla Carmel-Hurwitz → strips leading credentials", () => {
    expect(
      cleanContactName({ name: "CPCC, PCC Dikla Carmel-Hurwitz" }).name,
    ).toBe("Dikla Carmel-Hurwitz");
  });

  it("SHRM-CP, PHR Andrea Chiang → strips leading credentials", () => {
    expect(
      cleanContactName({ name: "SHRM-CP, PHR Andrea Chiang" }).name,
    ).toBe("Andrea Chiang");
  });

  it("Paulo A. Garcia, Ph.D. → strips Ph.D.", () => {
    expect(cleanContactName({ name: "Paulo A. Garcia, Ph.D." }).name).toBe("Paulo A. Garcia");
  });

  it("Audrey Heinesen, Ed.D. → strips Ed.D.", () => {
    expect(cleanContactName({ name: "Audrey Heinesen, Ed.D." }).name).toBe("Audrey Heinesen");
  });

  it("Sabrina (NBC Universal, KNTV) Hughes → keeps unchanged (parens)", () => {
    expect(
      cleanContactName({ name: "Sabrina (NBC Universal, KNTV) Hughes" }).name,
    ).toBe("Sabrina (NBC Universal, KNTV) Hughes");
  });

  it("does not mangle legit names that start with an acronym", () => {
    expect(cleanContactName({ name: "MC Hammer" }).name).toBe("MC Hammer");
    expect(cleanContactName({ name: "DJ Khaled" }).name).toBe("DJ Khaled");
  });

  it("Joe Schmidt IV stays Joe Schmidt IV (no comma)", () => {
    expect(cleanContactName({ name: "Joe Schmidt IV" }).name).toBe("Joe Schmidt IV");
  });
});

describe("cleanContactName — bug classes from second dry-run", () => {
  // A. Common surnames colliding with degree abbreviations.
  it("Jeff Ma is not eaten by the MA degree abbreviation", () => {
    expect(cleanContactName({ name: "Jeff Ma" }).name).toBe("Jeff Ma");
    expect(cleanContactName({ name: "David Ma" }).name).toBe("David Ma");
    expect(cleanContactName({ name: "Emily Ma" }).name).toBe("Emily Ma");
  });

  it("MA still strips with a comma boundary", () => {
    expect(cleanContactName({ name: "Sarah Chen, MA" }).name).toBe("Sarah Chen");
  });

  // B. Multiple trailing credentials separated by commas — needs looping.
  it("David Yu, PhD, CFA — strips both credentials", () => {
    expect(cleanContactName({ name: "David Yu, PhD, CFA" }).name).toBe("David Yu");
  });

  it("Sarah, MD, MBA, CFA — strips entire credential stack", () => {
    expect(cleanContactName({ name: "Sarah Chen, MD, MBA, CFA" }).name).toBe("Sarah Chen");
  });

  // C. Leading credential stack with off-dictionary token after.
  it("MD, MBE Wendy Sue Swanson — strips both MD and MBE", () => {
    expect(
      cleanContactName({ name: "MD, MBE Wendy Sue Swanson" }).name,
    ).toBe("Wendy Sue Swanson");
  });

  it("PhD, CISSP Marcus Chen — strips both leading credentials", () => {
    expect(cleanContactName({ name: "PhD, CISSP Marcus Chen" }).name).toBe("Marcus Chen");
  });

  // D. All-caps short tokens after a comma — context-sensitive.
  it("MULCAHY,SIMON (CSV-style LAST,FIRST) is left unchanged", () => {
    // SIMON is a first name, not a credential. The head being all-caps
    // signals this is a CSV-export format and should not have the tail
    // treated as a credential.
    expect(cleanContactName({ name: "MULCAHY,SIMON" }).name).toBe("MULCAHY,SIMON");
  });

  it("Sarah Chen, CISSP — strips CISSP despite not being in the dictionary", () => {
    // Head is title-case → tail can be a short all-caps credential.
    expect(cleanContactName({ name: "Sarah Chen, CISSP" }).name).toBe("Sarah Chen");
  });
});

describe("cleanContactName — over-strip guard + trailing-punctuation sweep", () => {
  // Catastrophic over-strip case from third dry-run. The aggressive trailing-
  // comma strip used to chew past the real name when both sides looked like
  // credentials (FELLOW DR DD SWAIN all matched the all-caps acronym pattern).
  it("catastrophic over-strip: cred-heavy input is left alone, not reduced to credentials", () => {
    const r = cleanContactName({ name: "PhD, LLB, MBA, MCOM, FELLOW DR DD SWAIN" });
    // We can't recover the real name from this input; the guard's job
    // is just to ensure we don't make it WORSE by returning a credential.
    expect(r.name).not.toBe("PhD");
    expect(r.name).not.toBe("LLB");
    expect(r.name).not.toBe("MBA");
  });

  it("trailing dash artifact is swept after credential removal", () => {
    expect(cleanContactName({ name: "Cena Kamali - MSc, MA" }).name).toBe("Cena Kamali");
    expect(cleanContactName({ name: "Marc H. Hartmann - MBA" }).name).toBe("Marc H. Hartmann");
  });

  it("trailing period after a multi-letter token is swept", () => {
    expect(cleanContactName({ name: "Daniel Castro. MD, MBA, MSc" }).name).toBe("Daniel Castro");
  });

  it("trailing period after a single-letter initial is preserved", () => {
    // "Pejman H." — H. is an initial, must not become "Pejman H"
    expect(cleanContactName({ name: "Pejman H." }).name).toBe("Pejman H.");
    expect(cleanContactName({ name: "John N." }).name).toBe("John N.");
    expect(cleanContactName({ name: "Jeffrey M." }).name).toBe("Jeffrey M.");
  });

  it("preserves single-letter initial mid-name", () => {
    // "John A. Smith" — both initial and last name should survive untouched
    expect(cleanContactName({ name: "John A. Smith" }).name).toBe("John A. Smith");
  });

  it("does not touch hyphenated surnames", () => {
    expect(cleanContactName({ name: "Renée Sharabi-Levine" }).name).toBe("Renée Sharabi-Levine");
    expect(cleanContactName({ name: "Joseph O'Connor-Smith" }).name).toBe("Joseph O'Connor-Smith");
  });

  it("handles combined dash + comma + period artifacts in one pass", () => {
    expect(
      cleanContactName({ name: "Joseph Yacura - M.B.A." }).name,
    ).toBe("Joseph Yacura");
  });
});

describe("inferFromEmail", () => {
  it("splits on dots", () => {
    expect(inferFromEmail("marcus.chen@x.com")).toBe("Marcus Chen");
  });

  it("splits on underscores and hyphens", () => {
    expect(inferFromEmail("jane_doe@x.com")).toBe("Jane Doe");
    expect(inferFromEmail("jane-doe@x.com")).toBe("Jane Doe");
  });

  it("drops +tags", () => {
    expect(inferFromEmail("marcus.chen+work@x.com")).toBe("Marcus Chen");
  });

  it("returns null for opaque hex locals", () => {
    expect(inferFromEmail("a1b2c3d4e5f6@x.com")).toBeNull();
  });

  it("returns null for single-char locals", () => {
    expect(inferFromEmail("a@x.com")).toBeNull();
  });

  it("returns null for all-numeric locals", () => {
    expect(inferFromEmail("12345@x.com")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(inferFromEmail("noatsign")).toBeNull();
    expect(inferFromEmail("")).toBeNull();
    expect(inferFromEmail(null)).toBeNull();
  });
});
