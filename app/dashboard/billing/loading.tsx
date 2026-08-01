import { Loading, SkeletonHead, SkeletonStats, SkeletonCard } from "../../Skeleton";

// Shown while this page's data is being read on the server. Shaped like the page it
// replaces, so nothing moves when the real content arrives.
export default function LoadingPage() {
  return (
    <Loading label="Loading your billing">
      <SkeletonHead />
      <SkeletonStats count={2} />
      <SkeletonCard lines={3} />
    </Loading>
  );
}
