export type WarmthLevel = "good" | "mid" | "cold" | "none";

interface WarmthAvatarProps {
  initials: string;
  warmth: WarmthLevel;
  size?: number;
  avatarUrl?: string | null;
}

const WARMTH_STYLES: Record<WarmthLevel, { bg: string; border: string; text: string }> = {
  good: { bg: "#EDF5F0", border: "#4A8C5E", text: "#4A8C5E" },
  mid: { bg: "#FBF5E8", border: "#C4962E", text: "#C4962E" },
  cold: { bg: "#FAEAE7", border: "#BF5040", text: "#BF5040" },
  none: { bg: "#F3F4F6", border: "#C8CDD3", text: "#C8CDD3" },
};

export function WarmthAvatar({ initials, warmth, size = 34, avatarUrl }: WarmthAvatarProps) {
  const style = WARMTH_STYLES[warmth];
  const radius = size * 0.38;

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden font-semibold ${warmth === "cold" ? "crm-cold-pulse" : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: style.bg,
        border: `1.5px solid ${style.border}`,
        fontSize: size * 0.32,
        lineHeight: 1,
        color: style.text,
        letterSpacing: "-0.02em",
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={initials}
          className="h-full w-full object-cover"
          style={{ borderRadius: radius - 1.5 }}
        />
      ) : (
        initials.toUpperCase().slice(0, 2)
      )}
    </div>
  );
}
