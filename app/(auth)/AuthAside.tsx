// The dark proof panel that sits beside the auth form. Pure presentation, 
// no state, no server APIs, so it can be pulled into the client auth forms.
export function AuthAside({ variant = "signin" }: { variant?: "signin" | "signup" }) {
  return (
    <aside className="authside">
      <p className="authside-quote">
        {variant === "signup" ? (
          <>
            Stop buying lists. Start calling businesses that <span className="accent">actually need you</span>.
          </>
        ) : (
          <>
            Every lead re-audited <span className="accent">live</span>, the moment you search.
          </>
        )}
      </p>
      <p className="authside-sub">
        We pull real businesses from open map data, check whether the phone rings, the email
        lands and the site still works, then grade what&apos;s left.
      </p>
      <div className="authside-proof">
        <div>
          <b>3-step</b>
          <span>Discover · verify · grade</span>
        </div>
        <div>
          <b>0</b>
          <span>Scraped or resold lists</span>
        </div>
        <div>
          <b>Live</b>
          <span>Checked at search time</span>
        </div>
      </div>
    </aside>
  );
}
