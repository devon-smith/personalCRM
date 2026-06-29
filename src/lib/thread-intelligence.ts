// ─── Types ───

export type ReplyPriority = "high" | "medium" | "low" | "skip";

// ─── Noise detection ───

/** Subjects that are almost never reply-worthy */
const SKIP_SUBJECT_PATTERNS = [
  /^(fwd|fw):/i,
  /newsletter/i,
  /unsubscribe/i,
  /digest/i,
  /\bweekly\b.*\b(update|recap|summary|report)\b/i,
  /\bmonthly\b.*\b(update|recap|summary|report)\b/i,
  /\bdaily\b.*\b(update|recap|summary|report)\b/i,
  /out of office/i,
  /auto.?reply/i,
  /automatic reply/i,
  /invitation:/i,
  /accepted:/i,
  /declined:/i,
  /canceled:/i,
  /updated invitation/i,
  /\breceipt\b/i,
  /\binvoice\b/i,
  /\bconfirmation\b/i,
  /\bverif(y|ication)\b/i,
  /\bpassword\b.*\breset\b/i,
  /\bwelcome to\b/i,
  /\bsign(ed)? up\b/i,
  /\bnotification\b/i,
  /do not reply/i,
];

/** Body patterns that signal no reply needed */
const SKIP_BODY_PATTERNS = [
  /this is an automated/i,
  /do not reply/i,
  /no.?reply/i,
  /unsubscribe/i,
  /you are receiving this/i,
  /this email was sent/i,
  /manage your preferences/i,
  /view in browser/i,
  /email preferences/i,
];

export function isNoiseEmail(
  subject: string | null,
  body: string | null,
): boolean {
  if (subject) {
    for (const pattern of SKIP_SUBJECT_PATTERNS) {
      if (pattern.test(subject)) return true;
    }
  }
  if (body) {
    let matchCount = 0;
    for (const pattern of SKIP_BODY_PATTERNS) {
      if (pattern.test(body)) matchCount++;
    }
    // 2+ signals = almost certainly automated
    if (matchCount >= 2) return true;
  }
  return false;
}

// ─── Priority scoring ───

export function scoreReplyPriority(
  subject: string | null,
  body: string | null,
  daysWaiting: number,
  threadDepth: number,
  contactTier: string | null,
): { priority: ReplyPriority; reason: string } {
  // First check if it's noise
  if (isNoiseEmail(subject, body)) {
    return { priority: "skip", reason: "Automated or newsletter" };
  }

  let score = 0;
  const reasons: string[] = [];

  // Time urgency — older = more urgent
  if (daysWaiting >= 7) {
    score += 3;
    reasons.push(`${daysWaiting}d waiting`);
  } else if (daysWaiting >= 3) {
    score += 2;
    reasons.push(`${daysWaiting}d waiting`);
  } else if (daysWaiting >= 1) {
    score += 1;
  }

  // Thread has back-and-forth = real conversation, higher priority
  if (threadDepth >= 3) {
    score += 2;
    reasons.push("Active thread");
  } else if (threadDepth >= 2) {
    score += 1;
  }

  // Contact importance
  if (contactTier === "INNER_CIRCLE") {
    score += 2;
    reasons.push("Inner circle");
  } else if (contactTier === "PROFESSIONAL") {
    score += 1;
  }

  // Question marks in subject = likely expecting an answer
  const questionInSubject = subject && /\?/.test(subject);
  const questionInBody = body && (body.match(/\?/g)?.length ?? 0) >= 1;
  if (questionInSubject) {
    score += 2;
    reasons.push("Question asked");
  } else if (questionInBody) {
    score += 1;
  }

  // Urgency language
  const urgentPattern = /\b(urgent|asap|time.?sensitive|deadline|due|by (today|tomorrow|monday|tuesday|wednesday|thursday|friday|end of))\b/i;
  const combinedText = [subject, body].filter(Boolean).join(" ");
  if (urgentPattern.test(combinedText)) {
    score += 2;
    reasons.push("Time-sensitive");
  }

  // Action language — they're asking you to do something
  const actionPattern = /\b(can you|could you|please|would you|let me know|send me|share|review|approve|confirm|schedule|call me)\b/i;
  if (actionPattern.test(combinedText)) {
    score += 1;
    if (!reasons.includes("Question asked")) {
      reasons.push("Action requested");
    }
  }

  // Map score to priority
  if (score >= 5) {
    return { priority: "high", reason: reasons.slice(0, 2).join(" · ") || "Needs reply" };
  }
  if (score >= 3) {
    return { priority: "medium", reason: reasons.slice(0, 2).join(" · ") || "Reply suggested" };
  }
  if (score >= 1) {
    return { priority: "low", reason: reasons[0] || "Low priority" };
  }
  return { priority: "low", reason: "No urgency signals" };
}
