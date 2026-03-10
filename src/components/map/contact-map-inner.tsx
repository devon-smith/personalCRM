"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

// Fix Leaflet default icon paths in Next.js
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const tierColors: Record<string, string> = {
  INNER_CIRCLE: "#9333ea",
  PROFESSIONAL: "#2563eb",
  ACQUAINTANCE: "#6b7280",
};

const tierLabels: Record<string, string> = {
  INNER_CIRCLE: "Inner Circle",
  PROFESSIONAL: "Professional",
  ACQUAINTANCE: "Acquaintance",
};

function createTierIcon(tier: string): L.DivIcon {
  const color = tierColors[tier] ?? "#6b7280";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: ${color};
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

export interface MapContact {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  tier: string;
  email: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  lastInteraction: string | null;
}

interface ContactMapInnerProps {
  contacts: MapContact[];
}

export function ContactMapInner({ contacts }: ContactMapInnerProps) {
  // Calculate center from contacts or default to world view
  const center = contacts.length > 0
    ? calculateCenter(contacts)
    : [39.8283, -98.5795] as [number, number]; // US center

  const zoom = contacts.length > 0 ? calculateZoom(contacts) : 4;

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      className="h-full w-full rounded-lg"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {contacts.map((contact) => (
        <Marker
          key={contact.id}
          position={[contact.latitude, contact.longitude]}
          icon={createTierIcon(contact.tier)}
        >
          <Popup>
            <div className="min-w-[180px]">
              <Link
                href="/contacts"
                className="text-sm font-semibold text-blue-700 hover:underline"
              >
                {contact.name}
              </Link>
              {contact.company && (
                <p className="text-xs text-gray-500">{contact.company}</p>
              )}
              {contact.role && (
                <p className="text-xs text-gray-500">{contact.role}</p>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className="text-[10px]"
                  style={{
                    backgroundColor: `${tierColors[contact.tier]}20`,
                    color: tierColors[contact.tier],
                  }}
                >
                  {tierLabels[contact.tier]}
                </Badge>
              </div>
              <p className="mt-1 text-[10px] text-gray-400">
                {[contact.city, contact.state, contact.country]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function calculateCenter(
  contacts: MapContact[]
): [number, number] {
  const lats = contacts.map((c) => c.latitude);
  const lngs = contacts.map((c) => c.longitude);
  return [
    lats.reduce((a, b) => a + b, 0) / lats.length,
    lngs.reduce((a, b) => a + b, 0) / lngs.length,
  ];
}

function calculateZoom(contacts: MapContact[]): number {
  if (contacts.length <= 1) return 10;
  const lats = contacts.map((c) => c.latitude);
  const lngs = contacts.map((c) => c.longitude);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const maxSpan = Math.max(latSpan, lngSpan);
  if (maxSpan > 100) return 2;
  if (maxSpan > 50) return 3;
  if (maxSpan > 20) return 4;
  if (maxSpan > 10) return 5;
  if (maxSpan > 5) return 6;
  if (maxSpan > 2) return 7;
  if (maxSpan > 1) return 8;
  return 10;
}
