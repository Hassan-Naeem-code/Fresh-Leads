// A compact set of common disposable / throwaway email domains. Not exhaustive, 
// enough to catch the obvious junk in scraped emails. A paid verifier (ZeroBounce)
// covers the long tail when configured.
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "throwawaymail.com", "yopmail.com", "getnada.com",
  "trashmail.com", "sharklasers.com", "fakeinbox.com", "maildrop.cc",
  "dispostable.com", "mailnesia.com", "mintemail.com", "spamgourmet.com",
  "mohmal.com", "emailondeck.com", "tempinbox.com", "burnermail.io",
]);

// Role/shared inboxes are valid but low-value for outreach, flagged, not rejected.
export const ROLE_PREFIXES = new Set([
  "info", "contact", "hello", "support", "sales", "admin", "office",
  "noreply", "no-reply", "postmaster", "webmaster", "enquiries", "team",
]);
