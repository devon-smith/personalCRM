interface MiniBarProps {
  good: number;
  mid: number;
  cold: number;
}

export function MiniBar({ good, mid, cold }: MiniBarProps) {
  const total = good + mid + cold;
  if (total === 0) return null;

  return (
    <div
      className="flex overflow-hidden"
      style={{ height: 3, borderRadius: 2, background: "#EEEFF1" }}
    >
      {good > 0 && (
        <div
          style={{
            width: `${(good / total) * 100}%`,
            backgroundColor: "#4A8C5E",
          }}
        />
      )}
      {mid > 0 && (
        <div
          style={{
            width: `${(mid / total) * 100}%`,
            backgroundColor: "#C4962E",
          }}
        />
      )}
      {cold > 0 && (
        <div
          style={{
            width: `${(cold / total) * 100}%`,
            backgroundColor: "#BF5040",
          }}
        />
      )}
    </div>
  );
}
