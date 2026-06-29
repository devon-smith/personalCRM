/**
 * Read-only deployment environment audit.
 *
 * Default:
 *   npm run deploy:audit
 *
 * Options:
 *   npx tsx scripts/audit-deployment-env.ts --strict
 *   npx tsx scripts/audit-deployment-env.ts --target-email=jaaker@stanford.edu
 *
 * This script reports only presence, shape, and risk signals. It does
 * not print secret values or connect to external services.
 */
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true, quiet: true });
dotenv.config({ path: ".env", quiet: true });

const DEFAULT_TARGET_EMAIL = "jaaker@stanford.edu";

type Severity = "high" | "medium" | "low";

interface Finding {
  readonly severity: Severity;
  readonly area: string;
  readonly message: string;
  readonly remediation: string;
}

interface Args {
  readonly strict: boolean;
  readonly targetEmail: string;
}

interface UrlSummary {
  readonly present: boolean;
  readonly valid: boolean;
  readonly protocol?: string;
  readonly port?: string;
  readonly hasPassword?: boolean;
  readonly hasDatabasePath?: boolean;
  readonly queryKeys?: string[];
  readonly hostHint?: string;
  readonly poolingHint?: string;
  readonly error?: string;
}

function parseArgs(): Args {
  let strict = false;
  let targetEmail = DEFAULT_TARGET_EMAIL;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--strict") strict = true;
    else if (arg.startsWith("--target-email=")) {
      targetEmail = arg.slice("--target-email=".length).trim() || DEFAULT_TARGET_EMAIL;
    }
  }

  return { strict, targetEmail: targetEmail.toLowerCase() };
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return [
    "your-",
    "change-me",
    "changeme",
    "placeholder",
    "example",
    "password@",
    ":password@",
    "secret-here",
  ].some((marker) => normalized.includes(marker));
}

function presentSummary(name: string) {
  const value = env(name);
  return {
    present: !!value,
    placeholder: isPlaceholder(value),
    length: value?.length ?? 0,
  };
}

function publicUrlSummary(name: string) {
  const value = env(name);
  if (!value) return { present: false, valid: false };

  try {
    const url = new URL(value);
    return {
      present: true,
      valid: true,
      protocol: url.protocol,
      hostHint: classifyHost(url.hostname),
      port: url.port || defaultPort(url.protocol),
      pathnameSet: url.pathname !== "/" && url.pathname.length > 0,
      placeholder: isPlaceholder(value),
    };
  } catch (error) {
    return {
      present: true,
      valid: false,
      placeholder: isPlaceholder(value),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function databaseUrlSummary(name: string): UrlSummary {
  const value = env(name);
  if (!value) return { present: false, valid: false };

  try {
    const url = new URL(value);
    const queryKeys = [...url.searchParams.keys()].sort();
    return {
      present: true,
      valid: true,
      protocol: url.protocol,
      port: url.port || defaultPort(url.protocol),
      hasPassword: !!url.password,
      hasDatabasePath: url.pathname !== "/" && url.pathname.length > 1,
      queryKeys,
      hostHint: classifyHost(url.hostname),
      poolingHint: classifyPooling(url),
    };
  } catch (error) {
    return {
      present: true,
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function defaultPort(protocol: string): string | undefined {
  if (protocol === "https:") return "443";
  if (protocol === "http:") return "80";
  if (protocol === "postgresql:" || protocol === "postgres:") return "5432";
  return undefined;
}

function classifyHost(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "local";
  if (host.includes("vercel.app")) return "vercel";
  if (host.includes("supabase")) return "supabase";
  if (host.includes("pooler")) return "pooler";
  if (host.includes("neon")) return "neon";
  if (host.includes("railway")) return "railway";
  if (host.includes("render")) return "render";
  if (host.includes("fly.dev")) return "fly";
  return "configured";
}

function classifyPooling(url: URL): string {
  const host = url.hostname.toLowerCase();
  const pgbouncer = url.searchParams.get("pgbouncer")?.toLowerCase() === "true";
  const port = url.port || defaultPort(url.protocol);

  if (pgbouncer || port === "6543") return "transaction-pooled";
  if (host.includes("pooler") && port === "5432") return "session-pooled";
  if (host.includes("pooler")) return "pooler-host";
  if (port === "5432") return "direct";
  return "unknown";
}

function parseAllowedEmails(targetEmail: string) {
  const raw = env("AUTH_ALLOWED_EMAILS");
  const emails =
    raw
      ?.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean) ?? [];

  return {
    present: !!raw,
    count: emails.length,
    includesTarget: emails.includes(targetEmail),
    containsDevon: emails.some((email) => email.includes("devon")),
    containsWildcard: emails.some((email) => email === "*" || email.includes("*")),
  };
}

function parseBudget(name: string, fallback: number) {
  const value = env(name);
  if (!value) return { present: false, valid: true, value: fallback, usingDefault: true };

  const parsed = Number(value);
  return {
    present: true,
    valid: Number.isFinite(parsed) && parsed >= 0,
    value: Number.isFinite(parsed) ? parsed : null,
    usingDefault: false,
  };
}

function addFinding(findings: Finding[], finding: Finding): void {
  findings.push(finding);
}

function buildFindings(args: Args): Finding[] {
  const findings: Finding[] = [];
  const nodeEnv = env("NODE_ENV");
  const vercelEnv = env("VERCEL_ENV");
  const productionLike = nodeEnv === "production" || vercelEnv === "production";
  const authUrl = env("NEXTAUTH_URL") ?? env("AUTH_URL") ?? env("NEXT_PUBLIC_APP_URL");
  const databaseUrl = env("DATABASE_URL");
  const workerDatabaseUrl = env("WORKER_DATABASE_URL");
  const db = databaseUrlSummary("DATABASE_URL");
  const workerDb = databaseUrlSummary("WORKER_DATABASE_URL");
  const allowedEmails = parseAllowedEmails(args.targetEmail);
  const webhookBase = publicUrlSummary("WEBHOOK_BASE_URL");
  const authUrlSummary = authUrl ? summarizeArbitraryUrl(authUrl) : null;
  const capacitorUrl = publicUrlSummary("CAPACITOR_SERVER_URL");
  const hasAnyPushConfig = !!(
    env("GMAIL_PUBSUB_TOPIC") ||
    env("WEBHOOK_BASE_URL") ||
    env("WEBHOOK_TOKEN")
  );
  const hasAllPushConfig = !!(
    env("GMAIL_PUBSUB_TOPIC") &&
    env("WEBHOOK_BASE_URL") &&
    env("WEBHOOK_TOKEN")
  );

  requireSecret(findings, "AUTH_SECRET", "Auth", "Set AUTH_SECRET to a long random value.");
  requireSecret(findings, "GOOGLE_CLIENT_ID", "Google OAuth", "Set GOOGLE_CLIENT_ID from the Google Cloud OAuth client.");
  requireSecret(findings, "GOOGLE_CLIENT_SECRET", "Google OAuth", "Set GOOGLE_CLIENT_SECRET from the Google Cloud OAuth client.");
  requireSecret(findings, "ANTHROPIC_API_KEY", "AI", "Set ANTHROPIC_API_KEY so Ask, reply drafts, and meeting prep can use Sonnet.");
  requireUrl(findings, db, "DATABASE_URL", "Database", "Set DATABASE_URL to the serverless-safe pooled Postgres URL.");

  if (!workerDatabaseUrl) {
    addFinding(findings, {
      severity: "high",
      area: "Worker",
      message: "WORKER_DATABASE_URL is missing.",
      remediation: "Set WORKER_DATABASE_URL to the direct Postgres connection string for Graphile Worker.",
    });
  } else if (!workerDb.valid) {
    addFinding(findings, {
      severity: "high",
      area: "Worker",
      message: "WORKER_DATABASE_URL is not a valid URL.",
      remediation: "Replace WORKER_DATABASE_URL with a valid direct Postgres connection string.",
    });
  }

  if (databaseUrl && workerDatabaseUrl && databaseUrl === workerDatabaseUrl) {
    addFinding(findings, {
      severity: "high",
      area: "Database",
      message: "DATABASE_URL and WORKER_DATABASE_URL are identical.",
      remediation: "Use a pooled/serverless-safe DATABASE_URL for Vercel and a direct WORKER_DATABASE_URL for the worker.",
    });
  }

  if (db.valid && db.poolingHint === "direct" && productionLike) {
    addFinding(findings, {
      severity: "medium",
      area: "Database",
      message: "DATABASE_URL looks direct in a production-like environment.",
      remediation: "Use a pooled/serverless-safe connection for Vercel web/API traffic.",
    });
  }

  if (
    workerDb.valid &&
    ["transaction-pooled", "pooler-host"].includes(workerDb.poolingHint ?? "")
  ) {
    addFinding(findings, {
      severity: "high",
      area: "Worker",
      message: "WORKER_DATABASE_URL looks transaction-pooled.",
      remediation: "Use the direct database connection for Graphile Worker to avoid prepared-statement failures.",
    });
  } else if (workerDb.valid && workerDb.poolingHint === "session-pooled") {
    addFinding(findings, {
      severity: "medium",
      area: "Worker",
      message: "WORKER_DATABASE_URL looks session-pooled rather than direct.",
      remediation: "Prefer the provider's direct Postgres URL for Graphile Worker, or confirm the session pooler keeps prepared statements stable.",
    });
  }

  if (!authUrl) {
    addFinding(findings, {
      severity: productionLike ? "high" : "medium",
      area: "Auth",
      message: "No production app URL was found in NEXTAUTH_URL, AUTH_URL, or NEXT_PUBLIC_APP_URL.",
      remediation: "Set NEXTAUTH_URL to the deployed HTTPS app URL before connecting OAuth callbacks.",
    });
  } else if (!authUrlSummary?.valid) {
    addFinding(findings, {
      severity: "high",
      area: "Auth",
      message: "The configured auth/app URL is invalid.",
      remediation: "Set NEXTAUTH_URL to a valid HTTPS URL for production.",
    });
  } else if (productionLike && authUrlSummary.protocol !== "https:") {
    addFinding(findings, {
      severity: "high",
      area: "Auth",
      message: "The production auth/app URL is not HTTPS.",
      remediation: "Set NEXTAUTH_URL to the deployed HTTPS app URL.",
    });
  }

  if (productionLike && !env("AUTH_TRUST_HOST")) {
    addFinding(findings, {
      severity: "low",
      area: "Auth",
      message: "AUTH_TRUST_HOST is not set in a production-like environment.",
      remediation: "Set AUTH_TRUST_HOST=true if the host/proxy requires trusted forwarded host headers.",
    });
  }

  if (!allowedEmails.present) {
    addFinding(findings, {
      severity: "high",
      area: "Auth",
      message: "AUTH_ALLOWED_EMAILS is missing, so the app falls back to built-in defaults.",
      remediation: `Set AUTH_ALLOWED_EMAILS to the intended account only, for example ${args.targetEmail}.`,
    });
  } else {
    if (!allowedEmails.includesTarget) {
      addFinding(findings, {
        severity: "high",
        area: "Auth",
        message: "AUTH_ALLOWED_EMAILS does not include the intended target user.",
        remediation: `Add ${args.targetEmail} to AUTH_ALLOWED_EMAILS.`,
      });
    }
    if (allowedEmails.containsWildcard) {
      addFinding(findings, {
        severity: "high",
        area: "Auth",
        message: "AUTH_ALLOWED_EMAILS appears to contain a wildcard.",
        remediation: "Limit AUTH_ALLOWED_EMAILS to explicit Google account emails.",
      });
    }
    if (allowedEmails.containsDevon && !args.targetEmail.includes("devon")) {
      addFinding(findings, {
        severity: "medium",
        area: "Auth",
        message: "AUTH_ALLOWED_EMAILS still includes a Devon account.",
        remediation: "Remove Devon/dev accounts from production auth allowlists for Jennifer's one-user launch.",
      });
    }
  }

  if (hasAnyPushConfig && !hasAllPushConfig) {
    addFinding(findings, {
      severity: "high",
      area: "Google push",
      message: "Google push sync is partially configured.",
      remediation: "Set GMAIL_PUBSUB_TOPIC, WEBHOOK_BASE_URL, and WEBHOOK_TOKEN together, or leave all unset for polling.",
    });
  } else if (!hasAllPushConfig) {
    addFinding(findings, {
      severity: "medium",
      area: "Google push",
      message: "Google push sync is not configured.",
      remediation: "Configure Pub/Sub and webhook env vars before relying on near-real-time Gmail/Calendar updates.",
    });
  }

  const pubsubTopic = env("GMAIL_PUBSUB_TOPIC");
  if (pubsubTopic && !/^projects\/[^/]+\/topics\/[^/]+$/.test(pubsubTopic)) {
    addFinding(findings, {
      severity: "medium",
      area: "Google push",
      message: "GMAIL_PUBSUB_TOPIC does not match projects/<project>/topics/<topic>.",
      remediation: "Use the full Pub/Sub topic resource name from Google Cloud.",
    });
  }

  if (webhookBase.present && !webhookBase.valid) {
    addFinding(findings, {
      severity: "high",
      area: "Google push",
      message: "WEBHOOK_BASE_URL is invalid.",
      remediation: "Set WEBHOOK_BASE_URL to the public HTTPS app URL used by Google webhooks.",
    });
  } else if (productionLike && webhookBase.present && webhookBase.protocol !== "https:") {
    addFinding(findings, {
      severity: "high",
      area: "Google push",
      message: "WEBHOOK_BASE_URL is not HTTPS in a production-like environment.",
      remediation: "Set WEBHOOK_BASE_URL to the deployed HTTPS app URL.",
    });
  }

  const webhookToken = env("WEBHOOK_TOKEN");
  if (webhookToken && webhookToken.length < 24) {
    addFinding(findings, {
      severity: "medium",
      area: "Google push",
      message: "WEBHOOK_TOKEN is shorter than recommended.",
      remediation: "Use a randomly generated token of at least 24 characters.",
    });
  }

  if (env("NEXT_PUBLIC_ENABLE_BROWSER_SYNC") === "true") {
    addFinding(findings, {
      severity: productionLike ? "high" : "medium",
      area: "Sync",
      message: "Browser fallback sync is enabled.",
      remediation: "Leave NEXT_PUBLIC_ENABLE_BROWSER_SYNC unset in production so tabs do not poll Gmail/Calendar.",
    });
  }

  if (!env("VOYAGE_API_KEY")) {
    addFinding(findings, {
      severity: "medium",
      area: "AI",
      message: "VOYAGE_API_KEY is missing.",
      remediation: "Set VOYAGE_API_KEY before launch if semantic search and retrieval quality should be production-ready.",
    });
  }

  if (!env("BRAVE_API_KEY")) {
    addFinding(findings, {
      severity: "low",
      area: "Research",
      message: "BRAVE_API_KEY is missing.",
      remediation: "Set BRAVE_API_KEY if meeting prep and public relationship research should include web signals.",
    });
  }

  for (const budget of [
    ["SYNC_BUDGET_PROVIDER_CALLS_PER_DAY", 40],
    ["SYNC_BUDGET_BROWSER_FALLBACK_CALLS_PER_DAY", 4],
    ["SYNC_BUDGET_ERROR_RATE_PERCENT", 10],
  ] as const) {
    const parsed = parseBudget(budget[0], budget[1]);
    if (!parsed.valid) {
      addFinding(findings, {
        severity: "medium",
        area: "Usage telemetry",
        message: `${budget[0]} is not a valid non-negative number.`,
        remediation: `Set ${budget[0]} to a non-negative numeric threshold.`,
      });
    } else if (!parsed.present) {
      addFinding(findings, {
        severity: "low",
        area: "Usage telemetry",
        message: `${budget[0]} is not set and the app will use its default.`,
        remediation: `Set ${budget[0]} after first-week telemetry if defaults are too loose.`,
      });
    }
  }

  if (capacitorUrl.present && !capacitorUrl.valid) {
    addFinding(findings, {
      severity: "medium",
      area: "Mobile",
      message: "CAPACITOR_SERVER_URL is invalid.",
      remediation: "Set CAPACITOR_SERVER_URL to the deployed HTTPS app URL for iPhone builds.",
    });
  } else if (productionLike && capacitorUrl.present && capacitorUrl.protocol !== "https:") {
    addFinding(findings, {
      severity: "medium",
      area: "Mobile",
      message: "CAPACITOR_SERVER_URL is not HTTPS in a production-like environment.",
      remediation: "Use the deployed HTTPS app URL before installing on Jennifer's iPhone.",
    });
  }

  return findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function summarizeArbitraryUrl(value: string) {
  try {
    const url = new URL(value);
    return {
      valid: true,
      protocol: url.protocol,
      hostHint: classifyHost(url.hostname),
      port: url.port || defaultPort(url.protocol),
      placeholder: isPlaceholder(value),
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
      placeholder: isPlaceholder(value),
    };
  }
}

function requireSecret(
  findings: Finding[],
  name: string,
  area: string,
  remediation: string,
): void {
  const value = env(name);
  if (!value) {
    addFinding(findings, {
      severity: "high",
      area,
      message: `${name} is missing.`,
      remediation,
    });
  } else if (isPlaceholder(value)) {
    addFinding(findings, {
      severity: "high",
      area,
      message: `${name} appears to contain a placeholder value.`,
      remediation,
    });
  }
}

function requireUrl(
  findings: Finding[],
  summary: UrlSummary,
  name: string,
  area: string,
  remediation: string,
): void {
  if (!summary.present) {
    addFinding(findings, {
      severity: "high",
      area,
      message: `${name} is missing.`,
      remediation,
    });
  } else if (!summary.valid) {
    addFinding(findings, {
      severity: "high",
      area,
      message: `${name} is not a valid URL.`,
      remediation,
    });
  }
}

function severityRank(severity: Severity): number {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
}

function countFindings(findings: Finding[]) {
  return findings.reduce(
    (counts, finding) => {
      counts[finding.severity]++;
      return counts;
    },
    { high: 0, medium: 0, low: 0 },
  );
}

function main() {
  const args = parseArgs();
  const findings = buildFindings(args);
  const report = {
    generatedAt: new Date().toISOString(),
    targetEmail: args.targetEmail,
    environment: {
      nodeEnv: env("NODE_ENV") ?? null,
      vercelEnv: env("VERCEL_ENV") ?? null,
      vercelDetected: !!env("VERCEL"),
      workerRuntime: env("CRM_WORKER_RUNTIME") === "true",
    },
    summary: countFindings(findings),
    sanitizedConfig: {
      auth: {
        AUTH_SECRET: presentSummary("AUTH_SECRET"),
        NEXTAUTH_URL: publicUrlSummary("NEXTAUTH_URL"),
        AUTH_URL: publicUrlSummary("AUTH_URL"),
        NEXT_PUBLIC_APP_URL: publicUrlSummary("NEXT_PUBLIC_APP_URL"),
        AUTH_TRUST_HOST: presentSummary("AUTH_TRUST_HOST"),
        AUTH_ALLOWED_EMAILS: parseAllowedEmails(args.targetEmail),
      },
      database: {
        DATABASE_URL: databaseUrlSummary("DATABASE_URL"),
        WORKER_DATABASE_URL: databaseUrlSummary("WORKER_DATABASE_URL"),
      },
      google: {
        GOOGLE_CLIENT_ID: presentSummary("GOOGLE_CLIENT_ID"),
        GOOGLE_CLIENT_SECRET: presentSummary("GOOGLE_CLIENT_SECRET"),
        GMAIL_PUBSUB_TOPIC: {
          present: !!env("GMAIL_PUBSUB_TOPIC"),
          validShape: env("GMAIL_PUBSUB_TOPIC")
            ? /^projects\/[^/]+\/topics\/[^/]+$/.test(env("GMAIL_PUBSUB_TOPIC")!)
            : false,
        },
        WEBHOOK_BASE_URL: publicUrlSummary("WEBHOOK_BASE_URL"),
        WEBHOOK_TOKEN: presentSummary("WEBHOOK_TOKEN"),
      },
      ai: {
        ANTHROPIC_API_KEY: presentSummary("ANTHROPIC_API_KEY"),
        VOYAGE_API_KEY: presentSummary("VOYAGE_API_KEY"),
        BRAVE_API_KEY: presentSummary("BRAVE_API_KEY"),
      },
      sync: {
        NEXT_PUBLIC_ENABLE_BROWSER_SYNC: presentSummary("NEXT_PUBLIC_ENABLE_BROWSER_SYNC"),
        NEXT_PUBLIC_DISABLE_BROWSER_SYNC: presentSummary("NEXT_PUBLIC_DISABLE_BROWSER_SYNC"),
        SYNC_BUDGET_PROVIDER_CALLS_PER_DAY: parseBudget(
          "SYNC_BUDGET_PROVIDER_CALLS_PER_DAY",
          40,
        ),
        SYNC_BUDGET_BROWSER_FALLBACK_CALLS_PER_DAY: parseBudget(
          "SYNC_BUDGET_BROWSER_FALLBACK_CALLS_PER_DAY",
          4,
        ),
        SYNC_BUDGET_ERROR_RATE_PERCENT: parseBudget(
          "SYNC_BUDGET_ERROR_RATE_PERCENT",
          10,
        ),
      },
      mobile: {
        CAPACITOR_SERVER_URL: publicUrlSummary("CAPACITOR_SERVER_URL"),
      },
    },
    findings,
    nextSteps: [
      "Fix all high findings before production deploy.",
      "Run this audit with --strict in CI or before Vercel promotion.",
      "Run npx prisma migrate deploy against the target production database.",
      "After deploy, verify Vercel logs, worker logs, and Settings usage telemetry.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));

  if (args.strict && findings.some((finding) => finding.severity === "high")) {
    process.exitCode = 1;
  }
}

main();
