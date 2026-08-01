import Link from "next/link";
import { Lock } from "../icons";

// What a locked account sees instead of the product.
//
// It says what happened, when, and what they were told, and it leaves one route open:
// writing to us. An account locked in error is a customer who needs to reach a person,
// and a dead end here turns a mistake into a chargeback.
export function Suspended({
  email,
  suspension,
}: {
  email: string;
  suspension: { at: string; reason: string | null };
}) {
  return (
    <div className="susp">
      <div className="card suspcard">
        <span className="susplock"><Lock size={22} /></span>
        <h1>This account is locked</h1>
        <p>
          Access for {email} was suspended on{" "}
          {new Date(suspension.at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          .
        </p>
        {suspension.reason && (
          <p className="suspreason">
            <b>The reason given:</b> {suspension.reason}
          </p>
        )}
        <p className="muted sm">
          Nothing has been deleted. Your leads, credits and history are all still here and
          come straight back if the lock is lifted.
        </p>
        <div className="suspacts">
          <a className="go accent" href="mailto:support@fresh-leads.io?subject=Account%20locked">
            Write to us about it
          </a>
          <form action="/auth/signout" method="post">
            <button className="ghost" type="submit">Sign out</button>
          </form>
        </div>
        <p className="muted sm">
          <Link href="/">Back to the site</Link>
        </p>
      </div>
    </div>
  );
}
