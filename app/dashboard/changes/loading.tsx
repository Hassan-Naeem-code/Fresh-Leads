import { Loading, SkeletonHead, SkeletonRows } from "../../Skeleton";

export default function LoadingPage() {
  return (
    <Loading label="Loading what changed">
      <SkeletonHead />
      <SkeletonRows rows={4} />
    </Loading>
  );
}
