"use client";

import dynamic from "next/dynamic";
import type { MapContact } from "./contact-map-inner";

const ContactMapInner = dynamic(
  () =>
    import("./contact-map-inner").then((mod) => mod.ContactMapInner),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center rounded-lg bg-gray-100">
        <p className="text-sm text-muted-foreground">Loading map...</p>
      </div>
    ),
  }
);

interface ContactMapProps {
  contacts: MapContact[];
}

export function ContactMap({ contacts }: ContactMapProps) {
  return <ContactMapInner contacts={contacts} />;
}
