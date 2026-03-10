interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface GeocodingResult {
  latitude: number;
  longitude: number;
}

/**
 * Geocode a location using the free Nominatim API (OpenStreetMap).
 * Rate limited to 1 request/second per Nominatim usage policy.
 */
export async function geocodeLocation(
  city: string | null,
  state: string | null,
  country: string | null
): Promise<GeocodingResult | null> {
  const parts = [city, state, country].filter(Boolean);
  if (parts.length === 0) return null;

  const query = parts.join(", ");

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "PersonalCRM/1.0",
      },
    });

    if (!res.ok) return null;

    const data: NominatimResult[] = await res.json();
    if (data.length === 0) return null;

    return {
      latitude: parseFloat(data[0].lat),
      longitude: parseFloat(data[0].lon),
    };
  } catch {
    return null;
  }
}

/**
 * Sleep for a given duration (for rate limiting).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
