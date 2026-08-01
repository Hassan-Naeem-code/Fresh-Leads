// Loading placeholders.
//
// The point of a skeleton is not decoration, it is that the page does not move when
// the content lands. Each piece here is sized to the thing it stands in for, so the
// layout is identical before and after: no jump, no reflow, no reading a heading that
// then slides out from under the cursor.
//
// Everything is marked aria-busy and hidden from screen readers. A person on a screen
// reader gets one "Loading" announcement from the live region, not forty empty boxes.

export function SkeletonLine({
  w = "100%",
  h = 14,
  className = "",
}: {
  w?: string | number;
  h?: number;
  className?: string;
}) {
  return <span className={`skel ${className}`} style={{ width: w, height: h }} />;
}

/** The page title block: eyebrow, heading, standfirst. */
export function SkeletonHead() {
  return (
    <div className="app-head skelhead">
      <SkeletonLine w={90} h={13} />
      <SkeletonLine w="55%" h={30} />
      <SkeletonLine w="80%" h={14} />
      <SkeletonLine w="62%" h={14} />
    </div>
  );
}

/** A card with a title and a few lines of body. */
export function SkeletonCard({ lines = 3, title = true }: { lines?: number; title?: boolean }) {
  return (
    <div className="card skelcard">
      {title && <SkeletonLine w={160} h={17} />}
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} w={i === lines - 1 ? "68%" : "100%"} />
      ))}
    </div>
  );
}

/** Rows in a list: an icon, two stacked lines, an action on the right. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card skelcard">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skelrow" key={i}>
          <span className="skel skelcircle" />
          <div>
            <SkeletonLine w="42%" h={14} />
            <SkeletonLine w="66%" h={12} />
          </div>
          <SkeletonLine w={78} h={26} />
        </div>
      ))}
    </div>
  );
}

/** The row of figures at the top of a dashboard. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="skelstats">
      {Array.from({ length: count }, (_, i) => (
        <div className="card skelstat" key={i}>
          <SkeletonLine w={64} h={11} />
          <SkeletonLine w={72} h={30} />
          <SkeletonLine w="80%" h={11} />
        </div>
      ))}
    </div>
  );
}

/**
 * Wrap any skeleton. Carries the accessibility contract in one place so no screen
 * can forget it.
 */
export function Loading({
  children,
  label = "Loading",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div className="wrap" aria-busy="true">
      <span className="visually-hidden" role="status">
        {label}
      </span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}
