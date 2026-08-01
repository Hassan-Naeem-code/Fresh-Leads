import { SkeletonLine } from "../Skeleton";

// The admin skeleton, minus the shell.
//
// The rail and the header are already on screen when a page loads, so redrawing them
// as grey boxes would be a step backwards: the parts that are known should stay known.
export function AdminLoading({ rows = 4, stats = 0 }: { rows?: number; stats?: number }) {
  return (
    <div className="adm-page" aria-busy="true">
      <span className="visually-hidden" role="status">Loading</span>
      <div aria-hidden="true">
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
    </div>
  );
}
