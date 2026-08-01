import { Loading, SkeletonHead, SkeletonCard } from "../../Skeleton";

// Shown while this page's data is being read on the server. Shaped like the page it
// replaces, so nothing moves when the real content arrives.
export default function LoadingPage() {
  return (
    <Loading label="Loading your account">
      <SkeletonHead />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={2} />
    </Loading>
  );
}
