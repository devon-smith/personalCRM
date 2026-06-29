import type { PrismaClient } from "@/generated/prisma/client";

export const DEFAULT_PROVIDER_CALL_LOG_RETENTION_DAYS = 180;
const MIN_PROVIDER_CALL_LOG_RETENTION_DAYS = 30;

export interface ProviderCallRetentionSummary {
  deletedRows: number;
  retentionDays: number;
  cutoff: Date;
}

export async function cleanupProviderCallLogs(
  prisma: PrismaClient,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<ProviderCallRetentionSummary> {
  const retentionDays = readProviderCallRetentionDays(env);
  const cutoff = subtractDays(now, retentionDays);
  const deleted = await prisma.providerCallLog.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });

  return {
    deletedRows: deleted.count,
    retentionDays,
    cutoff,
  };
}

export function readProviderCallRetentionDays(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.PROVIDER_CALL_LOG_RETENTION_DAYS;
  if (!raw?.trim()) return DEFAULT_PROVIDER_CALL_LOG_RETENTION_DAYS;

  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_PROVIDER_CALL_LOG_RETENTION_DAYS;

  const rounded = Math.floor(value);
  if (rounded < MIN_PROVIDER_CALL_LOG_RETENTION_DAYS) {
    return DEFAULT_PROVIDER_CALL_LOG_RETENTION_DAYS;
  }
  return rounded;
}

export function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}
