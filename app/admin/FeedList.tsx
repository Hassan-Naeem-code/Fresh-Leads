import Link from "next/link";
import {
  Coin, Search, Unlock, Key, Mail, Clock, User, Lock, Check, Building, MessageSquare,
} from "../icons";

// One activity feed, used by the platform view and by a single account.
//
// The two differ by one column: the platform feed names who did it, an account's feed
// does not. That is a prop rather than two components, because the row structure, the
// icons and the colour coding are the part worth keeping identical between them.

export type FeedItem = {
  at: string;
  kind: string;
  summary: string;
  detail?: string | null;
  userId?: string | null;
  email?: string | null;
};

const ICON: Record<string, React.ReactNode> = {
  signup: <User size={14} />,
  search: <Search size={14} />,
  unlock: <Unlock size={14} />,
  owner_unlock: <Unlock size={14} />,
  credits: <Coin size={14} />,
  subscription: <Coin size={14} />,
  ticket: <MessageSquare size={14} />,
  api_key: <Key size={14} />,
  crm: <Building size={14} />,
  sequence: <Mail size={14} />,
  enrichment: <Check size={14} />,
  admin: <Lock size={14} />,
};

// Short, human, and the same word an operator would use out loud.
const KIND_LABEL: Record<string, string> = {
  signup: "Signed up",
  search: "Search",
  unlock: "Lead",
  owner_unlock: "Owner",
  credits: "Credits",
  subscription: "Plan",
  ticket: "Support",
  api_key: "API",
  crm: "CRM",
  sequence: "Email",
  enrichment: "Enrichment",
  admin: "Operator",
};

/** "3 minutes ago" up to a week, then the date. Recency is what an operator scans for. */
function when(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function FeedList({ items, showWho = false }: { items: FeedItem[]; showWho?: boolean }) {
  return (
    <ul className="feed">
      {items.map((e, i) => (
        <li key={i} className={`feedrow ${e.kind}`}>
          <span className="feedchip">{ICON[e.kind] ?? <Clock size={14} />}</span>

          <div className="feedmain">
            <div className="feedtop">
              <span className="feedkind">{KIND_LABEL[e.kind] ?? e.kind}</span>
              <b>{e.summary}</b>
            </div>
            {(e.detail || (showWho && e.email)) && (
              <span className="feedsub">
                {showWho &&
                  (e.userId ? (
                    <Link href={`/admin/users/${e.userId}`}>{e.email ?? "an account"}</Link>
                  ) : (
                    <span>system</span>
                  ))}
                {showWho && e.detail && <span className="feeddot">·</span>}
                {e.detail}
              </span>
            )}
          </div>

          {/* The exact time stays in the tooltip: the relative one is for scanning,
              the absolute one is what you need when something has gone wrong. */}
          <time className="feedwhen" dateTime={e.at} title={new Date(e.at).toLocaleString()}>
            {when(e.at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
