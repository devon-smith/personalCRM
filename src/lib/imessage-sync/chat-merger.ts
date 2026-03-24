import { getChatParticipants } from "@/lib/imessage";
import { resolveHandleToContact, ContactLookupMaps } from "./handle-resolver";

// ─── Types ───────────────────────────────────────────────────

interface ActiveChat {
  chatRowId: number;
  chatName: string | null;
  isGroupChat: boolean;
  serviceName: string;
  recentMessageCount: number;
}

export interface ResolvedChat {
  readonly chat: ActiveChat;
  readonly participants: ReadonlyArray<{ handleId: string; service: string }>;
  readonly handleToContact: Map<string, string>;
  readonly contactIds: Set<string>;
  readonly defaultContactId: string;
}

export interface ChatGroup {
  readonly canonical: ResolvedChat;
  readonly members: ReadonlyArray<ResolvedChat>;
  readonly chatId: string;
  readonly isGroupChat: boolean;
  readonly chatName: string | null;
  readonly mergedHandleToContact: Map<string, string>;
}

// ─── Resolve chats to contacts ──────────────────────────────

export async function resolveChatsToContacts(
  chats: ReadonlyArray<ActiveChat>,
  lookups: ContactLookupMaps,
): Promise<{ resolved: ResolvedChat[]; unmatchedCount: number; errors: string[] }> {
  const resolved: ResolvedChat[] = [];
  let unmatchedCount = 0;
  const errors: string[] = [];

  for (const chat of chats) {
    const { participants, error: partError } = await getChatParticipants(chat.chatRowId);
    if (partError) {
      errors.push(`chat ${chat.chatRowId}: ${partError}`);
      continue;
    }

    const handleToContact = new Map<string, string>();
    const contactIds = new Set<string>();

    for (const p of participants) {
      const cId = resolveHandleToContact(p.handleId, lookups);
      if (cId) {
        handleToContact.set(p.handleId, cId);
        contactIds.add(cId);
      }
    }

    if (contactIds.size === 0) {
      unmatchedCount++;
      continue;
    }

    resolved.push({
      chat,
      participants,
      handleToContact,
      contactIds,
      defaultContactId: [...contactIds][0],
    });
  }

  return { resolved, unmatchedCount, errors };
}

// ─── Group chats by resolved contact set ────────────────────
// Apple creates multiple chat ROWIDs for the same conversation
// when services switch (iMessage ↔ SMS). By resolving handles
// to contacts first, we detect and merge these duplicates.

export function groupChatsByContacts(resolvedChats: ReadonlyArray<ResolvedChat>): ChatGroup[] {
  const groups = new Map<string, ResolvedChat[]>();

  for (const rc of resolvedChats) {
    const key = [...rc.contactIds].sort().join(",");
    const group = groups.get(key) ?? [];
    group.push(rc);
    groups.set(key, group);
  }

  return [...groups.values()].map((members) => {
    // Pick canonical chat: the ROWID with the most recent messages
    const canonical = members.reduce((best, rc) =>
      rc.chat.recentMessageCount > best.chat.recentMessageCount ? rc : best,
    );

    const isGroupChat = canonical.chat.isGroupChat || members.length > 1;
    const chatName = canonical.chat.chatName
      ?? members.find((rc) => rc.chat.chatName)?.chat.chatName
      ?? null;

    // Merge handle→contact maps from all ROWIDs in this group
    const mergedHandleToContact = new Map<string, string>();
    for (const rc of members) {
      for (const [h, c] of rc.handleToContact) {
        mergedHandleToContact.set(h, c);
      }
    }

    return {
      canonical,
      members,
      chatId: `imsg-chat:${canonical.chat.chatRowId}`,
      isGroupChat,
      chatName,
      mergedHandleToContact,
    };
  });
}
