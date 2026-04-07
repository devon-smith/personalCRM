import { vi } from "vitest";

// ─── Prisma mock ────────────────────────────────────────────
// Mock the entire prisma module so tests importing modules that
// use prisma don't crash. Individual tests can override as needed.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    interaction: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    inboxItem: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    emailMessage: { count: vi.fn().mockResolvedValue(0) },
    gmailSyncState: { findUnique: vi.fn() },
    thread: { upsert: vi.fn() },
    threadParticipant: { upsert: vi.fn() },
    actionItem: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

// ─── Date helpers ───────────────────────────────────────────

export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
