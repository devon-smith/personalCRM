"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, Locate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WarmthAvatar } from "@/components/ui/warmth-avatar";
import { getInitials } from "@/lib/avatar";
import type { MapResponse, MapContact } from "@/app/api/circles/map/route";

// ─── Dynamically import Leaflet components (no SSR) ──────────
const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false },
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false },
);
const CircleMarker = dynamic(
  () => import("react-leaflet").then((m) => m.CircleMarker),
  { ssr: false },
);
const Popup = dynamic(
  () => import("react-leaflet").then((m) => m.Popup),
  { ssr: false },
);
const Tooltip = dynamic(
  () => import("react-leaflet").then((m) => m.Tooltip),
  { ssr: false },
);

// ─── Load Leaflet CSS at runtime ─────────────────────────────
function useLeafletCSS() {
  useEffect(() => {
    const id = "leaflet-css";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }, []);
}

// ─── Group nearby contacts (~0.5 deg ≈ ~50km) ───────────────
interface MarkerGroup {
  readonly lat: number;
  readonly lng: number;
  readonly contacts: readonly MapContact[];
  readonly primaryColor: string;
}

function groupNearbyContacts(contacts: readonly MapContact[]): readonly MarkerGroup[] {
  const groups: MarkerGroup[] = [];
  const threshold = 0.5; // degrees

  for (const contact of contacts) {
    const existing = groups.find(
      (g) =>
        Math.abs(g.lat - contact.latitude) < threshold &&
        Math.abs(g.lng - contact.longitude) < threshold,
    );

    if (existing) {
      (existing.contacts as MapContact[]).push(contact);
    } else {
      groups.push({
        lat: contact.latitude,
        lng: contact.longitude,
        contacts: [contact],
        primaryColor: contact.circleColor,
      });
    }
  }

  // Recalculate center for multi-contact groups
  return groups.map((g) => {
    if (g.contacts.length === 1) return g;
    const avgLat =
      g.contacts.reduce((s, c) => s + c.latitude, 0) / g.contacts.length;
    const avgLng =
      g.contacts.reduce((s, c) => s + c.longitude, 0) / g.contacts.length;
    return { ...g, lat: avgLat, lng: avgLng };
  });
}

// ─── Location display ────────────────────────────────────────
function formatLocation(contact: MapContact): string {
  const parts: string[] = [];
  if (contact.city) parts.push(contact.city);
  if (contact.state) parts.push(contact.state);
  if (contact.country && contact.country !== "US") parts.push(contact.country);
  return parts.join(", ") || "Unknown";
}

// ─── Circle filter legend ────────────────────────────────────
function CircleLegend({
  circles,
  activeFilter,
  onFilter,
}: {
  readonly circles: readonly { id: string; name: string; color: string; count: number }[];
  readonly activeFilter: string | null;
  readonly onFilter: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {circles.map((c) => (
        <button
          key={c.id}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all"
          style={{
            backgroundColor:
              activeFilter === c.id
                ? `${c.color}20`
                : activeFilter === null
                  ? `${c.color}10`
                  : "transparent",
            color:
              activeFilter === null || activeFilter === c.id
                ? c.color
                : "var(--text-tertiary)",
            border:
              activeFilter === c.id
                ? `1px solid ${c.color}40`
                : "1px solid transparent",
            opacity: activeFilter !== null && activeFilter !== c.id ? 0.4 : 1,
            transitionDuration: "var(--duration-fast)",
          }}
          onClick={() => onFilter(activeFilter === c.id ? null : c.id)}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: c.color }}
          />
          {c.name}
          <span style={{ opacity: 0.6 }}>{c.count}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Enrich banner ───────────────────────────────────────────
function EnrichBanner({
  located,
  total,
}: {
  readonly located: number;
  readonly total: number;
}) {
  const queryClient = useQueryClient();
  const missing = total - located;

  const enrich = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/contacts/enrich-locations", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Enrichment failed");
      return res.json() as Promise<{ enriched: number; total: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["circles-map"] });
      if (data.enriched > 0) {
        // Shown via the updated stats
      }
    },
  });

  if (missing <= 0) return null;

  return (
    <div
      className="flex items-center justify-between rounded-[10px] px-3 py-2"
      style={{ backgroundColor: "var(--surface-sunken)" }}
    >
      <div className="flex items-center gap-2">
        <MapPin className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
        <span className="ds-caption" style={{ color: "var(--text-secondary)" }}>
          {missing} contact{missing !== 1 ? "s" : ""} without a location
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-[11px] rounded-lg"
        onClick={() => enrich.mutate()}
        disabled={enrich.isPending}
      >
        {enrich.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Locate className="h-3 w-3" />
        )}
        {enrich.isPending
          ? "Locating..."
          : enrich.isSuccess
            ? `Found ${enrich.data?.enriched ?? 0}`
            : "Locate them"}
      </Button>
    </div>
  );
}

// ─── Multi-contact popup content ─────────────────────────────
function PopupContent({
  contacts,
}: {
  readonly contacts: readonly MapContact[];
}) {
  if (contacts.length === 1) {
    const c = contacts[0];
    return (
      <div className="min-w-[160px] space-y-1">
        <div className="flex items-center gap-2">
          <WarmthAvatar
            initials={getInitials(c.name)}
            warmth="none"
            size={24}
            avatarUrl={c.avatarUrl}
          />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {c.name}
            </p>
            {c.role && c.company && (
              <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {c.role} at {c.company}
              </p>
            )}
            {!c.role && c.company && (
              <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {c.company}
              </p>
            )}
          </div>
        </div>
        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {formatLocation(c)}
        </p>
        <span
          className="inline-block mt-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: `${c.circleColor}15`, color: c.circleColor }}
        >
          {c.circleName}
        </span>
      </div>
    );
  }

  return (
    <div className="min-w-[180px] space-y-1">
      <p className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
        {formatLocation(contacts[0])}
      </p>
      <div className="max-h-[200px] overflow-y-auto space-y-1.5">
        {contacts.map((c) => (
          <div key={`${c.id}-${c.circleId}`} className="flex items-center gap-2">
            <WarmthAvatar
              initials={getInitials(c.name)}
              warmth="none"
              size={20}
              avatarUrl={c.avatarUrl}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                {c.name}
              </p>
              {c.company && (
                <p className="text-[10px] truncate" style={{ color: "var(--text-tertiary)" }}>
                  {c.company}
                </p>
              )}
            </div>
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: c.circleColor }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────
export function NetworkMap() {
  useLeafletCSS();

  const [circleFilter, setCircleFilter] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data, isLoading } = useQuery<MapResponse>({
    queryKey: ["circles-map"],
    queryFn: async () => {
      const res = await fetch("/api/circles/map");
      if (!res.ok) throw new Error("Failed to load map");
      return res.json();
    },
  });

  // Circle legend items
  const circleLegend = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { id: string; name: string; color: string; count: number }>();
    for (const c of data.contacts) {
      const existing = map.get(c.circleId);
      if (existing) {
        map.set(c.circleId, { ...existing, count: existing.count + 1 });
      } else {
        map.set(c.circleId, {
          id: c.circleId,
          name: c.circleName,
          color: c.circleColor,
          count: 1,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [data]);

  // Filtered contacts
  const filteredContacts = useMemo(() => {
    if (!data) return [];
    if (!circleFilter) return data.contacts;
    return data.contacts.filter((c) => c.circleId === circleFilter);
  }, [data, circleFilter]);

  // Marker groups
  const markerGroups = useMemo(
    () => groupNearbyContacts(filteredContacts),
    [filteredContacts],
  );

  // Map center
  const center = useMemo<[number, number]>(() => {
    if (filteredContacts.length === 0) return [39.8, -98.6]; // US center
    const avgLat =
      filteredContacts.reduce((s, c) => s + c.latitude, 0) /
      filteredContacts.length;
    const avgLng =
      filteredContacts.reduce((s, c) => s + c.longitude, 0) /
      filteredContacts.length;
    return [avgLat, avgLng];
  }, [filteredContacts]);

  const handleFilter = useCallback((id: string | null) => {
    setCircleFilter(id);
  }, []);

  if (!mounted) return null;

  if (isLoading) {
    return (
      <div
        className="mt-5 flex items-center justify-center rounded-[16px]"
        style={{
          height: 360,
          backgroundColor: "var(--surface-sunken)",
        }}
      >
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--text-tertiary)" }} />
      </div>
    );
  }

  if (!data || data.locatedContacts === 0) {
    return (
      <div
        className="mt-5 flex flex-col items-center justify-center gap-3 rounded-[16px] px-6 py-10"
        style={{
          backgroundColor: "var(--surface-sunken)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <MapPin className="h-8 w-8" style={{ color: "var(--text-tertiary)" }} />
        <div className="text-center">
          <p className="ds-heading-sm" style={{ color: "var(--text-secondary)" }}>
            No contacts on the map yet
          </p>
          <p className="mt-1 ds-caption" style={{ color: "var(--text-tertiary)" }}>
            Add locations to your contacts or click below to auto-detect them
          </p>
        </div>
        {data && data.totalContacts > 0 && (
          <EnrichBanner located={0} total={data.totalContacts} />
        )}
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-2">
      {/* Stats + legend */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
            {data.locatedContacts} on map
          </span>
          <span className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
            {data.cities} {data.cities === 1 ? "city" : "cities"}
          </span>
          <span className="ds-caption" style={{ color: "var(--text-tertiary)" }}>
            {data.countries} {data.countries === 1 ? "country" : "countries"}
          </span>
        </div>
        <CircleLegend
          circles={circleLegend}
          activeFilter={circleFilter}
          onFilter={handleFilter}
        />
      </div>

      {/* Map container */}
      <div
        className="overflow-hidden rounded-[14px]"
        style={{
          height: 360,
          border: "1px solid var(--border-subtle)",
        }}
      >
        <MapContainer
          center={center}
          zoom={filteredContacts.length <= 3 ? 6 : 3}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />

          {markerGroups.map((group, gi) => {
            const size = Math.min(4 + group.contacts.length * 2, 14);
            return (
              <CircleMarker
                key={`group-${gi}-${group.lat}-${group.lng}`}
                center={[group.lat, group.lng]}
                radius={size}
                pathOptions={{
                  color: group.primaryColor,
                  fillColor: group.primaryColor,
                  fillOpacity: 0.6,
                  weight: 1.5,
                }}
              >
                <Tooltip direction="top" offset={[0, -size]}>
                  <span className="text-[12px] font-medium">
                    {group.contacts.length === 1
                      ? group.contacts[0].name
                      : `${group.contacts.length} people`}
                  </span>
                </Tooltip>
                <Popup>
                  <PopupContent contacts={group.contacts} />
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      {/* Enrich banner */}
      {data.totalContacts > data.locatedContacts && (
        <EnrichBanner located={data.locatedContacts} total={data.totalContacts} />
      )}
    </div>
  );
}
