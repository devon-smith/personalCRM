"use client";

import Link from "next/link";
import { Activity, Database, Merge } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-12 pt-14">
      <div className="crm-animate-enter">
        <h1 className="ds-display-lg">Settings</h1>
        <p className="ds-body-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          Manage data sources, duplicates, and usage.
        </p>
      </div>

      <SettingsLink
        href="/integrations"
        icon={Database}
        title="Sources"
        description="Manage connected sources, sync data, and view data health"
        delay="20ms"
      />

      <SettingsLink
        href="/merge"
        icon={Merge}
        title="Merge duplicates"
        description="Review duplicate contacts, nickname matches, imports, and manual merges"
        delay="40ms"
      />

      <SettingsLink
        href="/settings/usage"
        icon={Activity}
        title="API usage"
        description="Token spend across Claude, Voyage, and search APIs. Per-feature breakdown."
        delay="60ms"
      />
    </div>
  );
}

function SettingsLink({
  href,
  icon: Icon,
  title,
  description,
  delay,
}: {
  href: string;
  icon: typeof Activity;
  title: string;
  description: string;
  delay: string;
}) {
  return (
    <Link
      href={href}
      className="crm-animate-enter crm-card flex items-center gap-3 p-5 transition-colors"
      style={{ animationDelay: delay }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--surface)"; }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-[10px]"
        style={{ backgroundColor: "var(--surface-sunken)" }}
      >
        <Icon className="h-5 w-5" style={{ color: "var(--text-secondary)" }} />
      </div>
      <div className="flex-1">
        <p className="ds-heading-sm">{title}</p>
        <p className="ds-caption mt-0.5">{description}</p>
      </div>
      <span className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>-&gt;</span>
    </Link>
  );
}
