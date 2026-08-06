"use client";

import { useEffect, useState } from "react";
import { Users, Check, AlertTriangle, Trash, Coin, Copy } from "../../icons";

type Role = "owner" | "admin" | "member";
type Member = { userId: string; email: string; role: Role; joinedAt: string };
type Invite = { id: string; email: string; role: string; expiresAt: string };
type Team = {
  id: string; name: string; role: Role; youAreTheOwner: boolean;
  /** Seats paid for, and seats filled. A seat is one person, priced as one account. */
  seats?: number; seatsUsed?: number;
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
  const [emailed, setEmailed] = useState(false);
  const [seatWanted, setSeatWanted] = useState(initial?.seats ?? 1);
  const [handOverTo, setHandOverTo] = useState("");
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The server render has the members but not the pending invites, which need a role
  // check. One fetch on mount rather than two code paths for the same list.
  useEffect(() => {
    if (initial) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Seats are changed on the subscription, not through checkout: a team that already
   *  pays must never be sent back through a flow that would create a SECOND
   *  subscription and bill them twice for the same year. */
  async function changeSeats() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/billing/seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seats: seatWanted }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change the seats");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the seats");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    try {
      const res = await fetch("/api/org");
      const data = await res.json();
      if (res.ok) {
        setTeam(data.team);
        if (data.team?.seats) setSeatWanted(data.team.seats);
      }
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
      // refresh() re-reads from the server rather than patching state locally, so
      // closing a team, leaving one, or handing it over all land on the truth rather
      // than on whatever this component believed a moment ago.
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

        {/* SEATS. A seat is one person and costs the same as one account, so working
            alone never got more expensive. Shown to everybody: a member who cannot
            invite anybody should be able to see the reason rather than ask. */}
        <div className="seatrow">
          <span>
            <b>{team.seatsUsed ?? team.members.length}</b> of <b>{team.seats ?? 1}</b>{" "}
            {(team.seats ?? 1) === 1 ? "seat" : "seats"} used
          </span>
          {(team.seatsUsed ?? 0) >= (team.seats ?? 1) && (
            <span className="muted sm">
              Every seat is taken. {team.youAreTheOwner ? "Add one to invite somebody else." : "Ask the owner to add one."}
            </span>
          )}
        </div>

        {team.youAreTheOwner && subscribed && (
          <div className="seatbuy">
            <label className="tf">
              Seats
              <input
                type="number"
                min={team.members.length}
                max={100}
                value={seatWanted}
                onChange={(e) => setSeatWanted(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <button
              className="ghost"
              disabled={busy || seatWanted === (team.seats ?? 1)}
              onClick={changeSeats}
            >
              {busy ? "Updating..." : `Change to ${seatWanted} ${seatWanted === 1 ? "seat" : "seats"}`}
            </button>
            <span className="muted sm">
              ${seatWanted * 30} a year in total. The difference is charged or credited to
              the card already on file, straight away.
            </span>
          </div>
        )}
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
                setEmailed(data.emailed === true);
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
                {emailed
                  ? "Sent to them by email. Here is the same link if you would rather send it yourself."
                  : "Send this to them yourself. Email is not configured on this deployment, so the link is the invite."}
                {" "}We show it once and never store it anywhere it can be read back, including by us.
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
              {/* Cancellable, because an invite link is a credential: it joins whoever
                  holds it to this team and lets them spend the shared balance. Sent to
                  a mistyped address, the only options used to be waiting a fortnight or
                  closing the team. */}
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
                    <div className="memberactions">
                      <button
                        className="ghost sm danger"
                        disabled={busy}
                        onClick={() => act({ action: "revoke_invite", inviteId: i.id })}
                      >
                        <Trash size={13} /> Cancel
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* HANDING OVER AND CLOSING.
          The owner's alone, because both move money. Until now the product refused to
          remove an owner with the words "transfer the team first" and there was no
          transfer, so an owner could not leave, hand over, or wind the team up. */}
      {team.youAreTheOwner && (
        <div className="card danger">
          <h3 className="cardtitle"><AlertTriangle size={16} /> Hand over or close</h3>

          {team.members.length > 1 ? (
            <>
              <p className="muted sm">
                The team&rsquo;s credits and every lead it has opened move with the
                ownership, so nobody has to buy any of it again. You stay on as an admin.
              </p>
              <p className="muted sm">
                <b>Your yearly plan does not move.</b> It is billed to your card, so the
                team&rsquo;s access will follow whoever takes over and they will need a plan
                on their own account.
              </p>
              <label className="tf">
                Hand the team to
                <select value={handOverTo} onChange={(e) => setHandOverTo(e.target.value)}>
                  <option value="">Choose somebody</option>
                  {team.members
                    .filter((m) => m.role !== "owner")
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>{m.email || m.userId}</option>
                    ))}
                </select>
              </label>
              <button
                className="ghost"
                disabled={busy || !handOverTo}
                onClick={() => act({ action: "transfer", userId: handOverTo })}
              >
                Hand over the team
              </button>
            </>
          ) : (
            <p className="muted sm">
              There is nobody to hand the team to yet. Invite somebody first, or close it.
            </p>
          )}

          <div className="teamclose">
            {!closing ? (
              <button className="ghost sm danger" onClick={() => setClosing(true)}>
                <Trash size={13} /> Close this team
              </button>
            ) : (
              <>
                <p className="muted sm">
                  Everyone goes back to their own account. <b>Nothing you have paid for is
                  lost:</b> the credits and every lead the team opened stay on your account,
                  because that is where they have been all along.
                </p>
                <div className="tkactions">
                  <button
                    className="go danger"
                    disabled={busy}
                    onClick={() => act({ action: "close" })}
                  >
                    Yes, close the team
                  </button>
                  <button className="ghost" onClick={() => setClosing(false)}>Keep it</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {error && <div className="status error"><AlertTriangle size={15} /> {error}</div>}
    </div>
  );
}
