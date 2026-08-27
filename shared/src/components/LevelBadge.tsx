// Shared visual for both dance levels: a plain digit on a filled CSS shape — square
// (blue) for lead, circle (purple) for follow, distinct shapes so the two are never
// confused at a glance. Digit-in-shape emoji (keycaps, circled digits) rendered too
// small/low-contrast to read reliably, hence CSS instead. Unset is always gray,
// regardless of shape, so it reads as "no value" rather than a specific level.
export function LevelBadge({
  level,
  shape,
}: {
  level: number | null;
  shape: "square" | "circle";
}) {
  const shapeClass = shape === "square" ? "level-badge-square" : "level-badge-circle";
  return (
    <span className={`level-badge-shape ${shapeClass}${level === null ? " level-badge-unset" : ""}`}>
      {/* A truly empty span has no line box in some browsers, shifting its vertical
          centering relative to a sibling that does contain a digit — a non-breaking
          space keeps both states' line-box metrics identical. */}
      {level ?? " "}
    </span>
  );
}
