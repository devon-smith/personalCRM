import "dotenv/config";
import { enqueue } from "../worker/queue-client";

function usage(): never {
  console.error("Usage: npx tsx scripts/enqueue.ts <task-name> [<json-payload>]");
  console.error('Example: npx tsx scripts/enqueue.ts memory-synthesis \'{"force":true}\'');
  process.exit(2);
}

async function main() {
  const [taskName, payloadArg] = process.argv.slice(2);
  if (!taskName) usage();

  let payload: Record<string, unknown> = {};
  if (payloadArg !== undefined) {
    try {
      const parsed = JSON.parse(payloadArg);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.error("Payload must be a JSON object.");
        process.exit(2);
      }
      payload = parsed as Record<string, unknown>;
    } catch (err) {
      console.error("Invalid JSON payload:", (err as Error).message);
      process.exit(2);
    }
  }

  const jobId = await enqueue(taskName, payload);
  console.log(`enqueued task=${taskName} job=${jobId} payload=${JSON.stringify(payload)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
