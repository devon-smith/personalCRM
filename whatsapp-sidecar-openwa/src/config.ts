import "dotenv/config";

export const config = {
  crmBaseUrl: process.env.CRM_BASE_URL || "http://localhost:3003",
  crmToken: process.env.CRM_EXTENSION_TOKEN || "",
  sessionDir: process.env.SESSION_DIR || "./session-data",
  sessionId: process.env.SESSION_ID || "personalcrm",
  chromePath: process.env.CHROME_PATH || undefined,
  logLevel: (process.env.LOG_LEVEL || "info") as
    | "info"
    | "debug"
    | "warn"
    | "error",
} as const;
