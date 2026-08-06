import { Search, Phone, Mail, MapPin, Check, Flame } from "./icons";

// A polished, static mock of the Fresh Leads dashboard, pure CSS/SVG so it stays crisp
// at any size. Gives the hero a real "this is a product" anchor.
//
// EVERY ROW MUST ANSWER THE QUERY ABOVE IT. This used to show a search for coffee shops
// returning a dentist in Round Rock and a landscaper in Cedar Park, which is the exact
// failure the product exists to avoid, demonstrated on the page selling it. It also put
// two towns fifteen to twenty miles out inside a ten mile radius.
//
// The grades still differ, because the point of the mock is that leads are ranked and
// the reason is stated. Three coffee shops make that point; a fourth row only makes the
// hero taller.
const LEADS = [
  { tier: "HOT", score: 92, name: "Brew & Co Coffee Roasters", cat: "Coffee shop · Austin, TX", signal: "No website, high need" },
  { tier: "WARM", score: 74, name: "Little Bird Espresso Bar", cat: "Coffee shop · Austin, TX", signal: "Verified owner email" },
  { tier: "COOL", score: 58, name: "Congress Avenue Roasting Co", cat: "Coffee shop · Austin, TX", signal: "Solid site, lower urgency" },
];

export function HeroMock() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-bar">
        <span className="mock-dots"><i /><i /><i /></span>
        <div className="mock-search">
          <Search size={14} />
          <span>coffee shops · Austin, TX · 10&nbsp;miles</span>
        </div>
        <span className="mock-live"><i />live</span>
      </div>
      <div className="mock-body">
        <div className="mock-chips">
          <span className="mock-chip on">Verified <Check size={11} /></span>
          <span className="mock-chip on">Has phone</span>
          <span className="mock-chip">HOT</span>
          <span className="mock-chip">Score 70+</span>
        </div>
        {LEADS.map((l) => (
          <div className="mock-lead" key={l.name}>
            <div className={`mock-badge ${l.tier}`}>
              {l.score}
              <small>{l.tier}</small>
            </div>
            <div className="mock-info">
              <b>{l.name}</b>
              <span className="mock-cat">{l.cat}</span>
              <div className="mock-verify">
                <span className="ok"><Mail size={11} /> deliverable</span>
                <span className="ok"><Phone size={11} /> verified</span>
                <span className="ok"><MapPin size={11} /> active</span>
              </div>
            </div>
            <div className="mock-signal">
              <Flame size={12} /> {l.signal}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
