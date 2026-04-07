import "dotenv/config";

export const config = {
  crmBaseUrl: process.env.CRM_BASE_URL || "http://localhost:3003",
  crmToken: process.env.CRM_EXTENSION_TOKEN || "",
  authDir: process.env.AUTH_DIR || "./auth-state",
  logLevel: (process.env.LOG_LEVEL || "info") as
    | "info"
    | "debug"
    | "warn"
    | "error",
} as const;
