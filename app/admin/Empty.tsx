import type { ReactNode } from "react";

// One empty state, used everywhere.
//
// The pages used to say the same thing twice: once in the subheading and again in the
// body. Saying nothing is here is one sentence, and it should carry what to do next
// rather than just report the absence.
export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="emptybox">
      {icon && <span className="emptyicon">{icon}</span>}
      <b>{title}</b>
      {hint && <span>{hint}</span>}
      {action}
    </div>
  );
}
