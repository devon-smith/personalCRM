/**
 * Sync a CRM Circle out to a Google contact group. CRM is the source
 * of truth — membership in the CRM circle wins over whatever is
 * currently in the Google group.
 *
 * Flow:
 *   1. Load circle + its current contact members.
 *   2. For contacts missing peopleApiResourceName, look them up from
 *      the user's Google contacts (cheap: People API connections are
 *      paginated, and lookups are O(contacts) one-time per contact).
 *   3. If the circle has no linked Google group yet, create one.
 *   4. Diff target membership against current Google membership;
 *      submit add/remove via members:modify.
 *   5. Persist sync timestamp + any error.
 *
 * Failures are caught and surfaced via Circle.googleSyncError so the
 * UI can show the user what went wrong without breaking the request.
 */

import { prisma } from "@/lib/prisma";
import { getGoogleAccessToken, googleFetchWithToken } from "@/lib/gmail/client";
import {
  createContactGroup,
  getContactGroup,
  modifyContactGroupMembers,
} from "@/lib/gmail/contact-groups";

const MAX_MEMBERS_PER_REQUEST = 1000;

export interface CircleSyncResult {
  circleId: string;
  added: number;
  removed: number;
  unresolved: number; // members we couldn't map to a People API resource
  googleGroupResourceName: string;
  googleSyncEnabled: boolean;
  googleSyncedAt: string;
  googleSyncError: null;
}

export async function syncCircleToGoogle(
  userId: string,
  circleId: string,
): Promise<CircleSyncResult> {
  const circle = await prisma.circle.findFirst({
    where: { id: circleId, userId },
    select: {
      id: true,
      name: true,
      googleGroupResourceName: true,
      googleSyncEnabled: true,
      contacts: {
        select: {
          contact: {
            select: {
              id: true,
              name: true,
              email: true,
              peopleApiResourceName: true,
            },
          },
        },
      },
    },
  });
  if (!circle) throw new Error("Circle not found");
  if (!circle.googleSyncEnabled) {
    throw new Error("Google sync is not enabled for this circle");
  }

  const token = await getGoogleAccessToken(userId);
  if (!token) {
    await markError(circleId, "No Google access token (reconnect required)");
    throw new Error("No Google access token");
  }

  // Resolve any missing People API resource names. We only do email-based
  // lookups; contacts with no email can't be group members.
  const contactsToResolve = circle.contacts
    .map((c) => c.contact)
    .filter((c) => !c.peopleApiResourceName && c.email);

  if (contactsToResolve.length > 0) {
    await resolveResourceNames(token, userId, contactsToResolve);
  }

  // Reload contacts to pick up the freshly-resolved resource names.
  const fresh = await prisma.contact.findMany({
    where: {
      id: { in: circle.contacts.map((c) => c.contact.id) },
    },
    select: { id: true, peopleApiResourceName: true },
  });
  const resolvedById = new Map(fresh.map((c) => [c.id, c.peopleApiResourceName]));

  const targetMembers = new Set<string>();
  let unresolved = 0;
  for (const cc of circle.contacts) {
    const rn = resolvedById.get(cc.contact.id);
    if (rn) {
      targetMembers.add(rn);
    } else {
      unresolved++;
    }
  }

  // Ensure the Google group exists. Create it lazily on first sync.
  let groupResourceName = circle.googleGroupResourceName;
  if (!groupResourceName) {
    try {
      const created = await createContactGroup(token, circle.name, {
        userId,
        feature: "circle_google_sync",
        metadata: { circleId },
      });
      groupResourceName = created.resourceName;
      await prisma.circle.update({
        where: { id: circleId },
        data: {
          googleGroupResourceName: groupResourceName,
        },
      });
    } catch (err) {
      await markError(circleId, errMessage(err));
      throw err;
    }
  }

  // Read current Google membership.
  let currentMembers = new Set<string>();
  try {
    const group = await getContactGroup(token, groupResourceName, {
      userId,
      feature: "circle_google_sync",
      metadata: { circleId },
    });
    if (group) {
      currentMembers = new Set(group.memberResourceNames ?? []);
    } else {
      // The linked group was deleted in Google. Recreate.
      const recreated = await createContactGroup(token, circle.name, {
        userId,
        feature: "circle_google_sync",
        metadata: { circleId, recreated: true },
      });
      groupResourceName = recreated.resourceName;
      await prisma.circle.update({
        where: { id: circleId },
        data: { googleGroupResourceName: groupResourceName },
      });
    }
  } catch (err) {
    await markError(circleId, errMessage(err));
    throw err;
  }

  // Diff.
  const toAdd = [...targetMembers].filter((m) => !currentMembers.has(m));
  const toRemove = [...currentMembers].filter((m) => !targetMembers.has(m));

  // Push the diff (chunked to respect the 1000-per-call cap).
  try {
    await applyMembershipDiff(userId, token, groupResourceName, toAdd, toRemove, {
      circleId,
    });
  } catch (err) {
    await markError(circleId, errMessage(err));
    throw err;
  }

  const syncedAt = new Date();
  await prisma.circle.update({
    where: { id: circleId },
    data: {
      googleSyncedAt: syncedAt,
      googleSyncError: null,
    },
  });

  return {
    circleId,
    added: toAdd.length,
    removed: toRemove.length,
    unresolved,
    googleGroupResourceName: groupResourceName,
    googleSyncEnabled: true,
    googleSyncedAt: syncedAt.toISOString(),
    googleSyncError: null,
  };
}

async function applyMembershipDiff(
  userId: string,
  token: string,
  groupResourceName: string,
  add: string[],
  remove: string[],
  metadata: Record<string, unknown>,
): Promise<void> {
  // People API caps add/remove at 1000 each per call. Chunk by max
  // of the two so a single call never exceeds either limit.
  const total = Math.max(add.length, remove.length);
  for (let i = 0; i < total; i += MAX_MEMBERS_PER_REQUEST) {
    const addChunk = add.slice(i, i + MAX_MEMBERS_PER_REQUEST);
    const removeChunk = remove.slice(i, i + MAX_MEMBERS_PER_REQUEST);
    await modifyContactGroupMembers(token, groupResourceName, addChunk, removeChunk, {
      userId,
      feature: "circle_google_sync",
      metadata: {
        ...metadata,
        chunkStart: i,
      },
    });
  }
}

/**
 * Resolve People API resource names by searching the user's Google
 * contacts by email. Persists results to Contact.peopleApiResourceName
 * so subsequent syncs skip this step.
 */
async function resolveResourceNames(
  token: string,
  userId: string,
  contacts: Array<{ id: string; email: string | null }>,
): Promise<void> {
  for (const c of contacts) {
    if (!c.email) continue;
    try {
      const rn = await searchPeopleByEmail(token, userId, c.email);
      if (rn) {
        await prisma.contact.update({
          where: { id: c.id },
          data: { peopleApiResourceName: rn },
        });
      }
    } catch (err) {
      // Per-contact failures don't abort the whole sync — they just
      // leave that contact unresolved in this round.
      console.error(
        `[circle-google-sync] resolveResourceName failed for ${c.email}:`,
        err,
      );
    }
  }
}

/** Search People API for a contact by email. Returns resourceName or null. */
async function searchPeopleByEmail(
  token: string,
  userId: string,
  email: string,
): Promise<string | null> {
  const url = new URL("https://people.googleapis.com/v1/people:searchContacts");
  url.searchParams.set("query", email);
  url.searchParams.set("readMask", "emailAddresses");

  const res = await googleFetchWithToken(token, url.toString(), undefined, {
    userId,
    service: "people",
    operation: "people.searchContacts",
    feature: "circle_google_sync",
    metadata: {
      lookup: "email",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: Array<{
      person?: {
        resourceName?: string;
        emailAddresses?: Array<{ value?: string }>;
      };
    }>;
  };
  for (const r of data.results ?? []) {
    const emails = r.person?.emailAddresses ?? [];
    if (emails.some((e) => e.value?.toLowerCase() === email.toLowerCase())) {
      return r.person?.resourceName ?? null;
    }
  }
  return null;
}

async function markError(circleId: string, message: string): Promise<void> {
  await prisma.circle.update({
    where: { id: circleId },
    data: {
      googleSyncError: message.slice(0, 500),
      googleSyncedAt: null,
    },
  }).catch(() => {});
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
