"use client";

import { useEffect, useState } from "react";
import { Users, Check, AlertTriangle, Trash, Coin, Copy } from "../../icons";

type Role = "owner" | "admin" | "member";
type Member = { userId: string; email: string; role: Role; joinedAt: string };
type Invite = { id: string; email: string; role: string; expiresAt: string };
type Team = {
  id: string; name: string; role: Role; youAreTheOwner: boolean;
  members: Member[]; invites: Invite[];
};

const ROLE_MEANING: Record<Role, string> = {
  owner: "Holds the credits and the plan. Cannot be removed.",
  admin: "Can invite and remove people. Cannot change billing.",
  member: "Can search and open leads from the shared balance.",
};

export function TeamPanel({
  initial, credits, subscribed,
}: {
  initial: Team | null;
  credits: number;
  subscribed: boolean;
}) {
  const [team, setTeam] = useState<Team | null>(initial);
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The server render has the members but not the pending invites, which need a role
  // check. One fetch on mount rather than two code paths for the same list.
  useEffect(() => {
    if (initial) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      const res = await fetch("/api/org");
      const data = await res.json();
      if (res.ok) setTeam(data.team);
    } catch {
      // Leaves the server-rendered list on screen, which is still correct.
    }
  }

  async function act(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That did not work");
      await refresh();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!team) {
    return (
      <div className="card">
        <h3 className="cardtitle"><Users size={16} /> Start a team</h3>
        <p className="muted sm">
          One balance, one yearly plan, and every lead anyone opens is open for everybody.
          A five person team currently needs five of everything and still pays twice for
          the same business when two people search the same town.
        </p>
        <p className="muted sm">
          Your credits and your plan become the team&rsquo;s. You stay in control of both.
        </p>
        <label className="tf">
          Team name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Digital"
            maxLength={80}
          />
        </label>
        <button
          className="go accent"
          onClick={() => act({ action: "create", name })}
          disabled={busy || name.trim().length < 2}
        >
          {busy ? "Creating..." : "Create the team"}
        </button>
        {error && <div className="status error"><AlertTriangle size={15} /> {error}</div>}
      </div>
    );
  }

  const canManage = team.role === "owner" || team.role === "admin";

  return (
    <div className="teamgrid">
      <div className="card">
        <h3 className="cardtitle"><Users size={16} /> {team.name}</h3>
        <div className="teamstat">
          <span className="teamstatnum"><Coin size={15} /> {credits}</span>
          <span className="muted sm">
            shared credits, spent by anyone on the team, from{" "}
            {team.youAreTheOwner ? "your" : "the owner's"} balance
          </span>
        </div>
        <p className="muted sm">
          {subscribed
            ? "The yearly plan covers everyone here. Nobody else needs to buy one."
            : "Nobody on this team has the yearly plan yet, so the paid sections stay locked for everybody."}
        </p>
      </div>

      <div className="card">
        <h3 className="cardtitle">Who is here</h3>
        <ul className="memberlist">
          {team.members.map((m) => (
            <li key={m.userId}>
              <div>
                <b>{m.email || "(no address on file)"}</b>
                <span className="muted sm">{ROLE_MEANING[m.role]}</span>
              </div>
              <div className="memberactions">
                <span className={`chip ${m.role === "owner" ? "on" : ""}`}>{m.role}</span>
                {canManage && m.role !== "owner" && (
                  <>
                    <button
                      className="ghost sm"
                      disabled={busy}
                      onClick={() =>
                        act({ action: "role", userId: m.userId, role: m.role === "admin" ? "member" : "admin" })
                      }
                    >
                      Make {m.role === "admin" ? "member" : "admin"}
                    </button>
                    <button
                      className="ghost sm danger"
                      disabled={busy}
                      onClick={() => act({ action: "remove", userId: m.userId })}
                    >
                      <Trash size={13} /> Remove
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!team.youAreTheOwner && (
          <button className="ghost sm" disabled={busy} onClick={() => act({ action: "leave" })}>
            Leave this team
          </button>
        )}
      </div>

      {canManage && (
        <div className="card">
          <h3 className="cardtitle">Invite somebody</h3>
          <p className="muted sm">
            The link only works for the address you send it to, and only once. It expires
            in a fortnight.
          </p>
          <label className="tf">
            Their email
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
            />
          </label>
          <div className="chips tight">
            {(["member", "admin"] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`chip toggle ${inviteRole === r ? "on" : ""}`}
                onClick={() => setInviteRole(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            className="go"
            disabled={busy || !inviteEmail.includes("@")}
            onClick={async () => {
              const data = await act({ action: "invite", email: inviteEmail, role: inviteRole });
              if (data?.link) {
                setLink(String(data.link));
                setInviteEmail("");
                setCopied(false);
              }
            }}
          >
            {busy ? "Creating the link..." : "Create an invite link"}
          </button>

          {link && (
            <div className="invitelink">
              <p className="muted sm">
                Send this to them yourself. We show it once and never store it in a form
                anyone can read back, including us.
              </p>
              <code>{link}</code>
              <button
                className="ghost sm"
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  setCopied(true);
                }}
              >
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link</>}
              </button>
            </div>
          )}

          {team.invites.length > 0 && (
            <>
              <h4 className="subhead">Waiting to be accepted</h4>
              <ul className="memberlist">
                {team.invites.map((i) => (
                  <li key={i.id}>
                    <div>
                      <b>{i.email}</b>
                      <span className="muted sm">
                        invited as {i.role}, expires{" "}
                        {new Date(i.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {error && <div className="status error"><AlertTriangle size={15} /> {error}</div>}
    </div>
  );
}
