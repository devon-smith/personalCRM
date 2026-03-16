import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getChatLookup, getMessageChatMapping, ChatInfo } from "@/lib/imessage";
import { normalizePhone } from "@/lib/name-utils";

export const maxDuration = 120;

/**
 * POST /api/inbox-items/migrate
 *
 * Backfills chatId on ALL Interactions.
 *
 * For iMessage/SMS: uses per-message GUID lookup from chat.db (source of truth),
 * falling back to per-contact handle lookup for messages not found by GUID.
 * For Gmail: uses EmailMessage.threadId.
 * For LinkedIn: synthesizes from contactId.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // 1. Get chat lookup (canonical ROWIDs via group_id dedup)
    const { handleToChats, canonicalRowId, error: chatError } = await getChatLookup();
    if (chatError) {
      console.warn(`[migrate] Chat lookup warning: ${chatError}`);
    }

    // 2. Get per-message GUID → chatRowId mapping from chat.db (90 days)
    const { guidToChat, error: guidError } = await getMessageChatMapping(90, canonicalRowId);
    if (guidError) {
      console.warn(`[migrate] GUID mapping warning: ${guidError}`);
    }
    console.log(`[migrate] Loaded ${guidToChat.size} GUID→chat mappings from chat.db`);

    // 3. Load contacts for handle-based fallback
    const contacts = await prisma.contact.findMany({
      where: { userId },
      select: { id: true, phone: true, email: true, additionalEmails: true },
    });

    const contactHandles = new Map<string, string[]>();
    for (const c of contacts) {
      const handles: string[] = [];
      if (c.phone) {
        handles.push(c.phone);
        handles.push(normalizePhone(c.phone));
        const digits = c.phone.replace(/\D/g, "");
        if (digits.length >= 10) handles.push(`+1${digits.slice(-10)}`);
      }
      if (c.email) handles.push(c.email.toLowerCase());
      for (const e of c.additionalEmails) handles.push(e.toLowerCase());
      contactHandles.set(c.id, handles);
    }

    function findChatsForContact(contactId: string): {
      oneToOne: ChatInfo | null;
      groups: ChatInfo[];
    } {
      const handles = contactHandles.get(contactId) ?? [];
      const allChats = new Map<number, ChatInfo>();
      for (const handle of handles) {
        for (const chat of (handleToChats.get(handle) ?? [])) {
          allChats.set(chat.chatRowId, chat);
        }
        const digits = handle.replace(/\D/g, "");
        if (digits.length >= 10) {
          const last10 = digits.slice(-10);
          for (const [h, chats] of handleToChats) {
            const hDigits = h.replace(/\D/g, "");
            if (hDigits.length >= 10 && hDigits.slice(-10) === last10) {
              for (const chat of chats) allChats.set(chat.chatRowId, chat);
            }
          }
        }
      }
      let oneToOne: ChatInfo | null = null;
      const groups: ChatInfo[] = [];
      for (const chat of allChats.values()) {
        if (chat.isGroupChat) groups.push(chat);
        else if (!oneToOne) oneToOne = chat;
      }
      return { oneToOne, groups };
    }

    // 4. Load Gmail thread IDs
    const emailInteractions = await prisma.interaction.findMany({
      where: { userId, channel: { in: ["gmail", "email"] }, sourceId: { not: null } },
      select: { id: true, sourceId: true },
    });
    const gmailIds = emailInteractions.map((i) => i.sourceId!).filter(Boolean);
    const emailMessages = gmailIds.length > 0
      ? await prisma.emailMessage.findMany({
          where: { userId, gmailId: { in: gmailIds } },
          select: { gmailId: true, threadId: true },
        })
      : [];
    const threadByGmailId = new Map(
      emailMessages.filter((e) => e.threadId).map((e) => [e.gmailId, e.threadId!]),
    );

    // 5. Get ALL interactions
    const allInteractions = await prisma.interaction.findMany({
      where: { userId },
      select: { id: true, contactId: true, channel: true, summary: true, subject: true, sourceId: true },
    });

    let updated = 0;
    let skipped = 0;
    let guidHits = 0;
    let handleFallbacks = 0;

    const batchSize = 25;
    const updates: { id: string; chatId: string; isGroupChat: boolean; chatName: string | null }[] = [];

    for (const ix of allInteractions) {
      const ch = (ix.channel ?? "").toLowerCase();

      let chatId: string | null = null;
      let isGroupChat = false;
      let chatName: string | null = null;

      if (ch === "gmail" || ch === "email") {
        const threadId = ix.sourceId ? threadByGmailId.get(ix.sourceId) : null;
        chatId = threadId ? `gmail:${threadId}` : `1:1:${ix.contactId}:email`;
      } else if (ch === "linkedin") {
        chatId = `1:1:${ix.contactId}:linkedin`;
      } else if (ch === "imessage" || ch === "sms" || ch === "text") {
        // PRIMARY: look up message GUID in chat.db for exact chatRowId
        const guid = extractGuid(ix.sourceId);
        const chatMapping = guid ? guidToChat.get(guid) : null;

        if (chatMapping) {
          chatId = `imsg-chat:${chatMapping.chatRowId}`;
          isGroupChat = chatMapping.isGroupChat;
          chatName = chatMapping.chatName;
          guidHits++;
        } else {
          // FALLBACK: per-contact handle lookup (for messages not in chat.db)
          const { oneToOne, groups } = findChatsForContact(ix.contactId);
          const isGroupSummary = (ix.summary ?? "").startsWith("(in group chat)");

          if (isGroupSummary) {
            isGroupChat = true;
            const subject = ix.subject;
            const matched = (subject && subject !== "Group message")
              ? groups.find((g) => g.chatName === subject || g.chatIdentifier === subject)
              : null;
            if (matched) {
              chatId = `imsg-chat:${matched.chatRowId}`;
              chatName = matched.chatName;
            } else {
              const first = groups[0];
              if (first) {
                chatId = `imsg-chat:${first.chatRowId}`;
                chatName = first.chatName;
              } else {
                chatId = `imsg-group:${ix.contactId}`;
                chatName = (subject && subject !== "Group message") ? subject : null;
              }
            }
          } else {
            if (oneToOne) {
              chatId = `imsg-chat:${oneToOne.chatRowId}`;
            } else {
              chatId = `1:1:${ix.contactId}:text`;
            }
          }
          handleFallbacks++;
        }
      } else {
        chatId = `1:1:${ix.contactId}:${ch}`;
      }

      if (!chatId) {
        skipped++;
        continue;
      }

      updates.push({ id: ix.id, chatId, isGroupChat, chatName });

      if (updates.length >= batchSize) {
        const batch = updates.splice(0, batchSize);
        await flushUpdates(batch);
        updated += batch.length;
      }
    }

    if (updates.length > 0) {
      updated += updates.length;
      await flushUpdates(updates);
    }

    console.log(`[inbox-migrate] Updated ${updated} (${skipped} skipped, ${guidHits} GUID hits, ${handleFallbacks} handle fallbacks)`);

    return NextResponse.json({
      ok: true,
      updated,
      skipped,
      total: allInteractions.length,
      guidHits,
      handleFallbacks,
    });
  } catch (error) {
    console.error("[POST /api/inbox-items/migrate]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Migration failed", detail: message },
      { status: 500 },
    );
  }
}

/** Extract message GUID from sourceId formats: "imsg-ind:GUID" or "imsg:GUID" */
function extractGuid(sourceId: string | null): string | null {
  if (!sourceId) return null;
  if (sourceId.startsWith("imsg-ind:")) return sourceId.slice(9);
  if (sourceId.startsWith("imsg:")) return sourceId.slice(5);
  return null;
}

async function flushUpdates(
  updates: { id: string; chatId: string; isGroupChat: boolean; chatName: string | null }[],
) {
  await prisma.$transaction(
    async (tx) => {
      for (const u of updates) {
        await tx.interaction.update({
          where: { id: u.id },
          data: {
            chatId: u.chatId,
            isGroupChat: u.isGroupChat,
            chatName: u.chatName,
          },
        });
      }
    },
    { timeout: 30000 },
  );
}
