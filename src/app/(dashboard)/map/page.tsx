"use client";

import { useState } from "react";
import { MapPin, Loader2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ContactMap } from "@/components/map/contact-map";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { MapContact } from "@/components/map/contact-map-inner";

interface MapData {
  contacts: MapContact[];
  ungeocodedCount: number;
}

const tierOptions = [
  { value: "", label: "All Tiers" },
  { value: "INNER_CIRCLE", label: "Inner Circle" },
  { value: "PROFESSIONAL", label: "Professional" },
  { value: "ACQUAINTANCE", label: "Acquaintance" },
];

export default function MapPage() {
  const [tier, setTier] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<MapData>({
    queryKey: ["map-contacts", tier],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (tier) params.set("tier", tier);
      const res = await fetch(`/api/contacts/map?${params}`);
      if (!res.ok) throw new Error("Failed to load map data");
      return res.json();
    },
  });

  const geocodeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/contacts/geocode", { method: "PATCH" });
      if (!res.ok) throw new Error("Geocoding failed");
      return res.json();
    },
    onSuccess: (result: { geocoded: number; failed: number }) => {
      toast.success(`Geocoded ${result.geocoded} contacts`);
      queryClient.invalidateQueries({ queryKey: ["map-contacts"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const contacts = data?.contacts ?? [];
  const ungeocodedCount = data?.ungeocodedCount ?? 0;

  return (
    <div className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-blue-500" />
          <h1 className="text-2xl font-bold text-gray-900">Contact Map</h1>
          <Badge variant="secondary" className="ml-1">
            {contacts.length} on map
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="h-8 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:border-blue-500"
          >
            {tierOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {ungeocodedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => geocodeMutation.mutate()}
              disabled={geocodeMutation.isPending}
            >
              {geocodeMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Globe className="mr-1.5 h-3 w-3" />
              )}
              Geocode {Math.min(ungeocodedCount, 10)} contacts
            </Button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4">
        <LegendItem color="#9333ea" label="Inner Circle" />
        <LegendItem color="#2563eb" label="Professional" />
        <LegendItem color="#6b7280" label="Acquaintance" />
      </div>

      {/* Map */}
      <div className="flex-1 overflow-hidden rounded-lg border border-gray-200">
        {isLoading ? (
          <div className="flex h-full items-center justify-center bg-gray-50">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-500" />
            <span className="text-sm text-muted-foreground">
              Loading map data...
            </span>
          </div>
        ) : contacts.length === 0 ? (
          <Card className="m-8">
            <CardContent className="py-12 text-center">
              <MapPin className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-700">
                No contacts with coordinates yet
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Add city/state/country to your contacts, then click
                &quot;Geocode&quot; to plot them on the map.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ContactMap contacts={contacts} />
        )}
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="h-3 w-3 rounded-full border-2 border-white shadow-sm"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}
