import { SkeletonLine } from "../Skeleton";

// The admin skeleton.
//
// It used to render the page body alone, on the assumption that the rail was already
// on screen. That assumption was wrong: the admin shell is rendered per page rather
// than in a layout, so a bare skeleton meant the sidebar VANISHED on every navigation
// and came back a moment later. Measuring the pages is what surfaced it, because the
// probe kept catching a screen with no shell in it at all.
//
// It now mirrors the shell's own geometry, so the rail stays put and only the work
// area changes.
export function AdminLoading({ rows = 4, stats = 0 }: { rows?: number; stats?: number }) {
  return (
    <div className="adm" aria-busy="true">
      <span className="visually-hidden" role="status">Loading</span>

      <aside className="adm-side" aria-hidden="true">
        <div className="adm-brand">
          <SkeletonLine w={26} h={26} className="skelcircle" />
          <SkeletonLine w={70} h={15} />
        </div>
        <div className="adm-nav">
          {Array.from({ length: 7 }, (_, i) => (
            <SkeletonLine key={i} w="86%" h={30} />
          ))}
        </div>
      </aside>

      <main className="adm-main" aria-hidden="true">
        <div className="adm-page">
          <SkeletonLine w={220} h={30} />
          <SkeletonLine w="60%" h={14} className="skelgap" />

          {stats > 0 && (
            <div className="skelstats">
              {Array.from({ length: stats }, (_, i) => (
                <div className="card skelstat" key={i}>
                  <SkeletonLine w={58} h={11} />
                  <SkeletonLine w={64} h={28} />
                </div>
              ))}
            </div>
          )}

          <div className="adm-panel skelcard">
            {Array.from({ length: rows }, (_, i) => (
              <div className="skelrow" key={i}>
                <span className="skel skelcircle" />
                <div>
                  <SkeletonLine w="38%" h={14} />
                  <SkeletonLine w="58%" h={12} />
                </div>
                <SkeletonLine w={62} h={22} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
