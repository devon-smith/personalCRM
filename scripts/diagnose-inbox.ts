import pg from "pg";
import dotenv from "dotenv";
import path from "path";

// Load .env.local first (higher priority), then .env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const { Client } = pg;

async function main() {
  console.log("Connecting to:", process.env.DATABASE_URL?.replace(/:[^@]+@/, ":***@"));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const userId = "250760e8-f6c9-4a6c-89ca-7bbce0982e00";
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  // 1. Find Cooper
  const cooperRes = await client.query(
    `SELECT id, name FROM "Contact" WHERE "userId" = $1 AND name ILIKE '%Cooper%' LIMIT 5`,
    [userId]
  );
  console.log("Cooper contacts:", cooperRes.rows);

  const cooperId = cooperRes.rows[0]?.id;
  if (cooperId) {
    // Cooper's chats breakdown
    const cooperChats = await client.query(
      `SELECT "chatId", direction, COUNT(*)::int as cnt,
        MAX("occurredAt") as latest,
        SUM(CASE WHEN "dismissedAt" IS NULL THEN 1 ELSE 0 END)::int as undismissed
      FROM "Interaction"
      WHERE "userId" = $1 AND "contactId" = $2 AND "occurredAt" > $3
        AND "chatId" IS NOT NULL
      GROUP BY "chatId", direction
      ORDER BY MAX("occurredAt") DESC`,
      [userId, cooperId, thirtyDaysAgo]
    );
    console.log("\nCooper chats (last 30 days):");
    for (const r of cooperChats.rows) {
      console.log(`  ${r.chatId} | ${r.direction} | count=${r.cnt} | undismissed=${r.undismissed} | latest=${r.latest}`);
    }

    // Cooper's latest 15 messages on main chat
    const cooperMsgs = await client.query(
      `SELECT direction, summary, "occurredAt", "dismissedAt", "sourceId", type
      FROM "Interaction"
      WHERE "userId" = $1 AND "contactId" = $2 AND "chatId" = 'imsg-chat:173'
        AND "occurredAt" > $3
      ORDER BY "occurredAt" DESC LIMIT 15`,
      [userId, cooperId, thirtyDaysAgo]
    );
    console.log("\nCooper latest 15 messages (imsg-chat:173):");
    for (const m of cooperMsgs.rows) {
      const dismissed = m.dismissedAt ? `DISMISSED` : "active";
      console.log(`  ${m.occurredAt.toISOString()} | ${m.direction} | ${dismissed} | ${(m.summary ?? "").slice(0, 80)}`);
    }
  }

  // 2. Current computed inbox — what the DISTINCT ON query returns as INBOUND
  const inboxRes = await client.query(
    `SELECT DISTINCT ON ("chatId")
      "chatId", "contactId", summary, "occurredAt"
    FROM "Interaction"
    WHERE "userId" = $1
      AND "chatId" IS NOT NULL
      AND "isGroupChat" = false
      AND "dismissedAt" IS NULL
      AND "occurredAt" > $2
      AND "type" != 'NOTE'
      AND "direction" = 'INBOUND'
      AND "chatId" NOT LIKE '1:1:%'
      AND ("sourceId" IS NULL OR "sourceId" NOT LIKE 'manual-reply:%')
      AND ("sourceId" IS NULL OR "sourceId" NOT LIKE 'bulk-reply:%')
    ORDER BY "chatId", "occurredAt" DESC`,
    [userId, thirtyDaysAgo]
  );

  // Check which have outbound after
  const inboxChatIds = inboxRes.rows.map((r: any) => r.chatId);

  const outboundAfterRes = inboxChatIds.length > 0
    ? await client.query(
        `SELECT DISTINCT sub."chatId"
        FROM (
          SELECT "chatId", MAX("occurredAt") as latest_inbound
          FROM "Interaction"
          WHERE "userId" = $1
            AND "chatId" = ANY($2)
            AND "direction" = 'INBOUND'
            AND "dismissedAt" IS NULL
            AND "type" != 'NOTE'
          GROUP BY "chatId"
        ) sub
        INNER JOIN "Interaction" ob
          ON ob."chatId" = sub."chatId"
          AND ob."userId" = $1
          AND ob."direction" = 'OUTBOUND'
          AND ob."type" != 'NOTE'
          AND ob."occurredAt" > sub.latest_inbound`,
        [userId, inboxChatIds]
      )
    : { rows: [] };

  const resolvedSet = new Set(outboundAfterRes.rows.map((r: any) => r.chatId));
  const trueInbox = inboxRes.rows.filter((r: any) => !resolvedSet.has(r.chatId));

  // Get contact names
  const contactIds = [...new Set(trueInbox.map((r: any) => r.contactId))];
  const contactsRes = contactIds.length > 0
    ? await client.query(
        `SELECT id, name FROM "Contact" WHERE id = ANY($1)`,
        [contactIds]
      )
    : { rows: [] };
  const nameMap = new Map(contactsRes.rows.map((c: any) => [c.id, c.name]));

  console.log(`\n\n=== TRUE INBOX (${trueInbox.length} items) ===`);
  for (const r of trueInbox) {
    console.log(`  ${(nameMap.get(r.contactId) ?? "Unknown").padEnd(25)} | ${r.chatId.padEnd(20)} | ${r.occurredAt.toISOString()} | ${(r.summary ?? "").slice(0, 50)}`);
  }

  // Check Cooper specifically
  if (cooperId) {
    const cooperInInbox = trueInbox.some((r: any) => r.contactId === cooperId);
    console.log(`\nCooper in true inbox: ${cooperInInbox}`);

    if (!cooperInInbox) {
      // Why is Cooper missing?
      const latestCooperInbound = await client.query(
        `SELECT "chatId", summary, "occurredAt", "dismissedAt"
        FROM "Interaction"
        WHERE "userId" = $1 AND "contactId" = $2
          AND direction = 'INBOUND' AND "type" != 'NOTE'
          AND "chatId" NOT LIKE '1:1:%'
          AND "isGroupChat" = false
          AND "occurredAt" > $3
        ORDER BY "occurredAt" DESC LIMIT 3`,
        [userId, cooperId, thirtyDaysAgo]
      );
      console.log("\nCooper latest inbound (checking dismissed status):");
      for (const m of latestCooperInbound.rows) {
        console.log(`  ${m.chatId} | ${m.occurredAt.toISOString()} | dismissed=${m.dismissedAt !== null} | ${(m.summary ?? "").slice(0, 60)}`);
      }

      // Check latest outbound in Cooper's chat
      const latestCooperOutbound = await client.query(
        `SELECT "chatId", summary, "occurredAt", "sourceId"
        FROM "Interaction"
        WHERE "userId" = $1 AND "chatId" = 'imsg-chat:173'
          AND direction = 'OUTBOUND' AND "type" != 'NOTE'
        ORDER BY "occurredAt" DESC LIMIT 3`,
        [userId]
      );
      console.log("\nCooper latest outbound:");
      for (const m of latestCooperOutbound.rows) {
        console.log(`  ${m.chatId} | ${m.occurredAt.toISOString()} | sourceId=${m.sourceId} | ${(m.summary ?? "").slice(0, 60)}`);
      }
    }
  }

  // 3. Check for chats that have dismissed inbound but also new undismissed (reappeared)
  const reappearedRes = await client.query(
    `WITH chat_stats AS (
      SELECT "chatId",
        SUM(CASE WHEN direction = 'INBOUND' AND "dismissedAt" IS NULL THEN 1 ELSE 0 END)::int as undismissed,
        SUM(CASE WHEN direction = 'INBOUND' AND "dismissedAt" IS NOT NULL THEN 1 ELSE 0 END)::int as dismissed_cnt,
        MAX(CASE WHEN direction = 'INBOUND' AND "dismissedAt" IS NULL THEN "occurredAt" END) as latest_undismissed,
        MAX(CASE WHEN direction = 'INBOUND' AND "dismissedAt" IS NOT NULL THEN "occurredAt" END) as latest_dismissed
      FROM "Interaction"
      WHERE "userId" = $1 AND "chatId" IS NOT NULL AND "chatId" NOT LIKE '1:1:%'
        AND "occurredAt" > $2 AND "isGroupChat" = false
      GROUP BY "chatId"
    )
    SELECT "chatId", undismissed, dismissed_cnt, latest_undismissed, latest_dismissed
    FROM chat_stats
    WHERE undismissed > 0 AND dismissed_cnt > 0
    ORDER BY latest_undismissed DESC LIMIT 15`,
    [userId, thirtyDaysAgo]
  );

  console.log(`\n\n=== CHATS WITH BOTH DISMISSED + UNDISMISSED INBOUND (reappeared?) ===`);
  for (const r of reappearedRes.rows) {
    console.log(`  ${r.chatId.padEnd(20)} | undismissed=${r.undismissed} | dismissed=${r.dismissed_cnt} | latest_undismissed=${r.latest_undismissed?.toISOString()} | latest_dismissed=${r.latest_dismissed?.toISOString()}`);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
