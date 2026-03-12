interface CircleIconProps {
  letter: string;
  color: string;
  size?: number;
}

export function CircleIcon({ letter, color, size = 36 }: CircleIconProps) {
  return (
    <div
      className="flex shrink-0 items-center justify-center font-semibold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: color,
        fontSize: size * 0.39,
        lineHeight: 1,
        letterSpacing: "-0.02em",
      }}
    >
      {letter.charAt(0).toUpperCase()}
    </div>
  );
}
