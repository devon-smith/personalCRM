"use client";

import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { useCircles } from "@/lib/hooks/use-circles";
import type { CircleWithContacts, CircleContact } from "@/lib/hooks/use-circles";
import { useQuery } from "@tanstack/react-query";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { WarmthAvatar } from "@/components/ui/warmth-avatar";
import { getInitials } from "@/lib/avatar";
import type { CircleStoriesResponse } from "@/app/api/circles/[id]/stories/route";

// ─── Seeded random for stable layouts ────────────────────────
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ─── Golden angle distribution ───────────────────────────────
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

interface StarPosition {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly brightness: number;
  readonly contact: CircleContact;
  readonly circleId: string;
  readonly circleColor: string;
}

interface ClusterPosition {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly circle: CircleWithContacts;
}

function computeLayout(
  circles: readonly CircleWithContacts[],
  width: number,
  height: number,
): { clusters: readonly ClusterPosition[]; stars: readonly StarPosition[] } {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxClusterRadius = Math.min(width, height) * 0.38;

  const nonEmpty = circles.filter((c) => c.contacts.length > 0);
  const empty = circles.filter((c) => c.contacts.length === 0);
  const all = [...nonEmpty, ...empty];

  const clusters: ClusterPosition[] = [];
  const stars: StarPosition[] = [];

  all.forEach((circle, i) => {
    // Golden angle spiral for cluster positions
    const angle = i * GOLDEN_ANGLE;
    const dist = Math.min(
      maxClusterRadius * Math.sqrt((i + 1) / (all.length + 1)),
      maxClusterRadius,
    );

    const cx = centerX + Math.cos(angle) * dist;
    const cy = centerY + Math.sin(angle) * dist;
    const clusterRadius = Math.max(
      40,
      Math.min(120, 30 + circle.contacts.length * 10),
    );

    clusters.push({ cx, cy, radius: clusterRadius, circle });

    // Position contacts within cluster
    const rng = seededRandom(circle.id.charCodeAt(0) * 1000 + circle.id.charCodeAt(1));

    circle.contacts.forEach((contact, ci) => {
      const starAngle = ci * GOLDEN_ANGLE + rng() * 0.5;
      const starDist = clusterRadius * 0.3 + rng() * clusterRadius * 0.6;
      const x = cx + Math.cos(starAngle) * starDist;
      const y = cy + Math.sin(starAngle) * starDist;

      // Brightness from recency (1.0 = today, 0.15 = 90+ days)
      const daysSince = contact.daysSince ?? 120;
      const brightness = Math.max(0.15, 1.0 - daysSince / 90);

      // Size from warmth
      const radius =
        contact.warmth === "good" ? 4 :
        contact.warmth === "mid" ? 3 : 2;

      stars.push({
        x,
        y,
        radius,
        brightness,
        contact,
        circleId: circle.id,
        circleColor: circle.color,
      });
    });
  });

  return { clusters, stars };
}

// ─── Background stars ────────────────────────────────────────
function generateBackgroundStars(
  width: number,
  height: number,
  count: number,
): readonly { x: number; y: number; r: number; opacity: number }[] {
  const rng = seededRandom(42);
  const result: { x: number; y: number; r: number; opacity: number }[] = [];
  for (let i = 0; i < count; i++) {
    result.push({
      x: rng() * width,
      y: rng() * height,
      r: 0.4 + rng() * 1.0,
      opacity: 0.08 + rng() * 0.2,
    });
  }
  return result;
}

// ─── Stories panel ───────────────────────────────────────────
function StoriesPanel({
  circleId,
  onClose,
}: {
  readonly circleId: string;
  readonly onClose: () => void;
}) {
  const [storyIndex, setStoryIndex] = useState(0);

  const { data, isLoading } = useQuery<CircleStoriesResponse>({
    queryKey: ["circle-stories", circleId],
    queryFn: async () => {
      const res = await fetch(`/api/circles/${circleId}/stories`);
      if (!res.ok) throw new Error("Failed to load stories");
      return res.json();
    },
  });

  const stories = data?.stories ?? [];
  const current = stories[storyIndex];

  const goNext = useCallback(() => {
    setStoryIndex((i) => Math.min(i + 1, stories.length - 1));
  }, [stories.length]);

  const goPrev = useCallback(() => {
    setStoryIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, onClose]);

  // Reset index when circle changes
  useEffect(() => {
    setStoryIndex(0);
  }, [circleId]);

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return `${diff} days ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-20 flex flex-col overflow-hidden"
      style={{
        width: 340,
        backgroundColor: "rgba(10, 12, 20, 0.95)",
        borderLeft: `2px solid ${data?.circleColor ?? "rgba(255,255,255,0.1)"}`,
        backdropFilter: "blur(20px)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h3 className="text-[14px] font-semibold text-white/90">
          {data?.circleName ?? "Stories"}
        </h3>
        <button
          onClick={onClose}
          className="rounded-full p-1 transition-colors hover:bg-white/10"
        >
          <X className="h-4 w-4 text-white/60" />
        </button>
      </div>

      {/* Progress bar */}
      {stories.length > 0 && (
        <div className="flex gap-[3px] px-4 pb-3">
          {stories.map((_, i) => (
            <button
              key={stories[i].id}
              className="h-[2px] flex-1 rounded-full transition-colors"
              style={{
                backgroundColor:
                  i === storyIndex
                    ? data?.circleColor ?? "#fff"
                    : i < storyIndex
                      ? "rgba(255,255,255,0.4)"
                      : "rgba(255,255,255,0.12)",
              }}
              onClick={() => setStoryIndex(i)}
            />
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {isLoading ? (
          <p className="text-[13px] text-white/40">Loading stories...</p>
        ) : stories.length === 0 ? (
          <p className="text-[13px] text-white/40 text-center">
            No recent moments in this circle.
            <br />
            Interactions from the last 14 days appear here.
          </p>
        ) : current ? (
          <div className="w-full space-y-4 text-center">
            <WarmthAvatar
              initials={getInitials(current.contactName)}
              warmth="none"
              size={56}
              avatarUrl={current.avatarUrl}
            />
            <div>
              <p className="text-[18px] font-semibold text-white/95">
                {current.headline}
              </p>
              {current.detail && (
                <p className="mt-2 text-[13px] text-white/50 leading-relaxed">
                  {current.detail}
                </p>
              )}
              <p
                className="mt-3 text-[12px] font-medium"
                style={{ color: data?.circleColor ?? "rgba(255,255,255,0.5)" }}
              >
                {formatTime(current.occurredAt)}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* Navigation arrows */}
      {stories.length > 1 && (
        <div className="flex items-center justify-between px-4 pb-4">
          <button
            onClick={goPrev}
            disabled={storyIndex === 0}
            className="rounded-full p-2 transition-colors hover:bg-white/10 disabled:opacity-20"
          >
            <ChevronLeft className="h-4 w-4 text-white/70" />
          </button>
          <span className="text-[11px] text-white/30">
            {storyIndex + 1} / {stories.length}
          </span>
          <button
            onClick={goNext}
            disabled={storyIndex === stories.length - 1}
            className="rounded-full p-2 transition-colors hover:bg-white/10 disabled:opacity-20"
          >
            <ChevronRight className="h-4 w-4 text-white/70" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Star tooltip ────────────────────────────────────────────
function StarTooltip({
  star,
  containerRef,
}: {
  readonly star: StarPosition;
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const rect = containerRef.current?.getBoundingClientRect();
  if (!rect) return null;

  // Keep tooltip within bounds
  const tooltipWidth = 180;
  let left = star.x - tooltipWidth / 2;
  if (left < 8) left = 8;
  if (left + tooltipWidth > rect.width - 8) left = rect.width - tooltipWidth - 8;

  return (
    <div
      className="pointer-events-none absolute z-10 rounded-[8px] px-3 py-2 text-center"
      style={{
        left,
        top: star.y - 50,
        width: tooltipWidth,
        backgroundColor: "rgba(10, 12, 20, 0.9)",
        border: "1px solid rgba(255,255,255,0.15)",
        backdropFilter: "blur(8px)",
      }}
    >
      <p className="text-[12px] font-medium text-white/90">
        {star.contact.name}
      </p>
      {star.contact.company && (
        <p className="text-[11px] text-white/40">{star.contact.company}</p>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────
export function ConstellationMap() {
  const { data: circles } = useCircles();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoveredStar, setHoveredStar] = useState<StarPosition | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<string | null>(null);
  const [activeStoryCircle, setActiveStoryCircle] = useState<string | null>(null);

  // ResizeObserver for responsive dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { clusters, stars } = useMemo(() => {
    if (!circles || dimensions.width === 0) {
      return { clusters: [], stars: [] };
    }
    return computeLayout(circles, dimensions.width, dimensions.height);
  }, [circles, dimensions]);

  const bgStars = useMemo(
    () => generateBackgroundStars(dimensions.width, dimensions.height, 80),
    [dimensions.width, dimensions.height],
  );

  if (!circles) return null;

  const totalContacts = circles.reduce((n, c) => n + c.contacts.length, 0);
  if (totalContacts === 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative mt-5 overflow-hidden rounded-[16px]"
      style={{
        height: 360,
        backgroundColor: "#0a0c14",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* SVG canvas */}
      {dimensions.width > 0 && (
        <svg
          width={dimensions.width}
          height={dimensions.height}
          className="absolute inset-0"
        >
          <defs>
            {/* Cluster glow filters */}
            {clusters.map((cl) => (
              <radialGradient
                key={`glow-${cl.circle.id}`}
                id={`nebula-${cl.circle.id}`}
              >
                <stop
                  offset="0%"
                  stopColor={cl.circle.color}
                  stopOpacity={hoveredCluster === cl.circle.id ? 0.2 : 0.1}
                />
                <stop
                  offset="100%"
                  stopColor={cl.circle.color}
                  stopOpacity={0}
                />
              </radialGradient>
            ))}
          </defs>

          {/* Background stars */}
          {bgStars.map((s, i) => (
            <circle
              key={`bg-${i}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="white"
              opacity={s.opacity}
            />
          ))}

          {/* Cluster nebulae */}
          {clusters.map((cl) => (
            <circle
              key={`nebula-${cl.circle.id}`}
              cx={cl.cx}
              cy={cl.cy}
              r={cl.radius * 1.8}
              fill={`url(#nebula-${cl.circle.id})`}
              className="transition-opacity"
              style={{ transitionDuration: "300ms" }}
            />
          ))}

          {/* Faint constellation lines within clusters */}
          {clusters.map((cl) => {
            const clusterStars = stars.filter(
              (s) => s.circleId === cl.circle.id,
            );
            const lines: React.ReactNode[] = [];
            for (let i = 1; i < clusterStars.length && i < 8; i++) {
              const a = clusterStars[i - 1];
              const b = clusterStars[i];
              lines.push(
                <line
                  key={`line-${cl.circle.id}-${i}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={cl.circle.color}
                  strokeWidth={0.5}
                  opacity={0.15}
                />,
              );
            }
            return lines;
          })}

          {/* Stars (contacts) */}
          {stars.map((star) => (
            <circle
              key={`star-${star.circleId}-${star.contact.id}`}
              cx={star.x}
              cy={star.y}
              r={
                hoveredStar?.contact.id === star.contact.id
                  ? star.radius + 2
                  : star.radius
              }
              fill="white"
              opacity={star.brightness}
              className="cursor-pointer transition-all"
              style={{ transitionDuration: "150ms" }}
              onMouseEnter={() => setHoveredStar(star)}
              onMouseLeave={() => setHoveredStar(null)}
              onClick={() => {
                window.location.href = `/people?contact=${star.contact.id}`;
              }}
            />
          ))}

          {/* Cluster labels */}
          {clusters.map((cl) => (
            <g key={`label-${cl.circle.id}`}>
              <text
                x={cl.cx}
                y={cl.cy + cl.radius + 18}
                textAnchor="middle"
                className="cursor-pointer select-none"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  fill:
                    hoveredCluster === cl.circle.id
                      ? cl.circle.color
                      : "rgba(255,255,255,0.45)",
                  transition: "fill 200ms",
                }}
                onMouseEnter={() => setHoveredCluster(cl.circle.id)}
                onMouseLeave={() => setHoveredCluster(null)}
                onClick={() => setActiveStoryCircle(cl.circle.id)}
              >
                {cl.circle.name}
              </text>
              <text
                x={cl.cx}
                y={cl.cy + cl.radius + 30}
                textAnchor="middle"
                style={{
                  fontSize: 9,
                  fill: "rgba(255,255,255,0.2)",
                }}
              >
                {cl.circle.contacts.length}
              </text>
            </g>
          ))}
        </svg>
      )}

      {/* Tooltip */}
      {hoveredStar && (
        <StarTooltip star={hoveredStar} containerRef={containerRef} />
      )}

      {/* Stories side panel */}
      {activeStoryCircle && (
        <StoriesPanel
          circleId={activeStoryCircle}
          onClose={() => setActiveStoryCircle(null)}
        />
      )}
    </div>
  );
}
