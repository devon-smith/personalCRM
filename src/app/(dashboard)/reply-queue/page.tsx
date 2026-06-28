import { Inbox } from "@/components/dashboard/inbox";
import { DraftQueue } from "@/components/dashboard/draft-queue";

export default function ReplyQueuePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Gmail reply workflow
        </div>
        <h1
          className="mt-1 ds-display-md"
          style={{ color: "var(--text-primary)" }}
        >
          Reply queue
        </h1>
        <p
          className="mt-1 max-w-2xl text-[13px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Triage inbound Gmail, review auto-drafted replies, and send through
          Gmail from one place.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section
          className="rounded-[12px] border p-4"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
          }}
        >
          <Inbox />
        </section>

        <aside
          className="rounded-[12px] border p-4 lg:sticky lg:top-6 lg:self-start"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
          }}
        >
          <DraftQueue />
        </aside>
      </div>
    </div>
  );
}
