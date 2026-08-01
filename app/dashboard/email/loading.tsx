import { Loading, SkeletonHead, SkeletonCard, SkeletonRows } from "../../Skeleton";

// Shown while this page's data is being read on the server. Shaped like the page it
// replaces, so nothing moves when the real content arrives.
export default function LoadingPage() {
  return (
    <Loading label="Loading your sequences">
      <SkeletonHead />
      <SkeletonCard lines={3} />
      <SkeletonRows rows={3} />
    </Loading>
  );
}
