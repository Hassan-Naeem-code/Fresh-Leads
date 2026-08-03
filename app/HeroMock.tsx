import { Search, Phone, Mail, MapPin, Check, Flame } from "./icons";

// A polished, static mock of the Fresh Leads dashboard, pure CSS/SVG so it stays
// crisp at any size. Gives the hero a real "this is a product" anchor.
const LEADS = [
  { tier: "HOT", score: 92, name: "Brew & Co Coffee Roasters", cat: "Coffee shop · Austin, TX", signal: "No website, high need" },
  { tier: "WARM", score: 74, name: "Bright Smile Dental Studio", cat: "Dentist · Round Rock, TX", signal: "Verified owner email" },
  { tier: "COOL", score: 58, name: "Hill Country Landscaping", cat: "Landscaper · Cedar Park, TX", signal: "Active · 12 yrs" },
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
