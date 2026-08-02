// The answers people actually write in asking for.
//
// Kept as data rather than as markup so the same set can be searched, linked to by
// anchor, and offered to someone in the middle of opening a ticket. The wording is
// deliberately plain and admits the limits: an FAQ that only says flattering things
// sends every real question to support.

export type FaqTopic = "credits" | "leads" | "billing" | "email" | "account" | "data";

export type FaqEntry = {
  id: string;
  topic: FaqTopic;
  q: string;
  /** Paragraphs. Kept short: an answer nobody finishes is not an answer. */
  a: string[];
  /** Words a person might search for that are not already in the question. */
  keywords?: string[];
};

export const FAQ_TOPICS: { id: FaqTopic; label: string }[] = [
  { id: "credits", label: "Credits" },
  { id: "leads", label: "Leads" },
  { id: "billing", label: "Billing" },
  { id: "email", label: "Email" },
  { id: "account", label: "Account" },
  { id: "data", label: "Your data" },
];

export const FAQ: FaqEntry[] = [
  {
    id: "what-is-a-credit",
    topic: "credits",
    q: "What is a credit?",
    a: [
      "One credit opens one lead. Credits are $1 each, and a lead you open is yours permanently: you can read it, re-export it, push it to your CRM and email it as often as you like without spending anything more.",
      "Running a search costs nothing. You need at least one credit in your balance to search, but the credit is only taken when you open a specific lead.",
    ],
    keywords: ["cost", "price", "spend", "unlock"],
  },
  {
    id: "credit-expiry",
    topic: "credits",
    q: "Do credits expire?",
    a: [
      "No. Credits sit in your balance until you spend them, including across a renewal. If your yearly plan lapses, your credits are still there when you come back.",
    ],
    keywords: ["expire", "lose", "lapse"],
  },
  {
    id: "bad-lead",
    topic: "credits",
    q: "What if a lead turns out to be unreachable?",
    a: [
      "We verify the phone and the mailbox before the credit is taken, so a lead that fails those checks is never charged for in the first place.",
      "If something still slips through, for example a business that closed between our check and your call, open a ticket with the business name and we will put the credit back.",
    ],
    keywords: ["refund", "bounce", "wrong number", "closed", "dead"],
  },
  {
    id: "volume-bonus",
    topic: "credits",
    q: "Is there a discount for buying in bulk?",
    a: [
      "Yes. Larger baskets carry bonus credits, and the exact bonus is shown on the billing screen before you pay. On top of that, buying 300 credits or more within one calendar month adds 50 free credits to your balance.",
    ],
    keywords: ["bulk", "discount", "bonus", "cheaper", "volume"],
  },
  {
    id: "where-leads-come-from",
    topic: "leads",
    q: "Where do the leads come from?",
    a: [
      "From public business listings, and then from the business's own website. We read the site the way a person would: the contact page, the about page, the team page, and the small print at the bottom.",
      "Nothing is bought from a list broker, which is why the details are current rather than a copy of a copy.",
    ],
    keywords: ["source", "scrape", "database", "where"],
  },
  {
    id: "grade",
    topic: "leads",
    q: "What does the grade mean?",
    a: [
      "It is how much the business looks like it needs what you sell, scored out of 100, with the reasons listed underneath. A high grade means we found real evidence, for example no website at all, a site that is down, or a booking system you replace.",
      "The grade depends on what you told us you sell, so two customers looking at the same restaurant can correctly see different grades.",
    ],
    keywords: ["score", "hot", "warm", "rating", "0-100"],
  },
  {
    id: "owner-name",
    topic: "leads",
    q: "Why does a lead sometimes have no owner name?",
    a: [
      "Because we could not find one we were confident in. We find an owner on roughly four in ten businesses, and it depends heavily on the trade: professions where a named practitioner is the product, like dentists and vets, name someone about six times in ten, while restaurants and salons name someone about twice in ten. We would rather show nothing than show you a guess.",
      "A wrong name in the first line of an email is worse than no name at all, so the sequence tools hold a message back rather than send one with a blank where a name should be.",
    ],
    keywords: ["owner", "contact name", "who", "missing"],
  },
  {
    id: "search-empty",
    topic: "leads",
    q: "My search returned nothing. What went wrong?",
    a: [
      "Usually the area is too tight or the business type is too specific. Widen the radius first, then try a broader description of what you are looking for.",
      "If a broad search in a large city still returns nothing, that is a fault on our side, not on yours. Open a ticket with the exact words you searched for.",
    ],
    keywords: ["no results", "empty", "zero", "nothing found"],
  },
  {
    id: "what-30-buys",
    topic: "billing",
    q: "What does the $30 a year actually pay for?",
    a: [
      "It keeps your account open and opens everything you do with a lead after you have opened it: your search history, bulk enrichment of your own lists, email sequences, pushing to HubSpot or Salesforce, and the API.",
      "It includes no credits. The two are separate on purpose, so you are never paying a monthly fee for leads you did not use.",
    ],
    keywords: ["subscription", "plan", "yearly", "fee", "what do i get"],
  },
  {
    id: "cancel",
    topic: "billing",
    q: "Can I cancel?",
    a: [
      "Yes, at any time, and you keep full access until the end of the year you have paid for. There is nothing to phone up about and nobody will try to talk you out of it.",
      "Leads you have already opened stay yours. Your searches stay saved, and they are still there if you come back.",
    ],
    keywords: ["cancel", "refund", "stop", "quit", "unsubscribe"],
  },
  {
    id: "receipt",
    topic: "billing",
    q: "Where are my receipts?",
    a: [
      "Every payment is receipted by email from our payment processor as soon as it goes through. Your credit history on the billing screen shows every credit in and out of your balance, with the running total.",
    ],
    keywords: ["invoice", "receipt", "vat", "tax"],
  },
  {
    id: "email-sending",
    topic: "email",
    q: "Why will my sequence not send?",
    a: [
      "Almost always one of two things: no sending provider is connected, or the domain you are sending from has not been verified yet. The Email screen says which one at the top.",
      "Verification is a DNS record you add at whoever hosts your domain. Once it is in place the queue picks up where it left off, and nobody loses their position in a sequence.",
    ],
    keywords: ["not sending", "stuck", "dns", "verify", "domain", "resend"],
  },
  {
    id: "unsubscribes",
    topic: "email",
    q: "What happens when someone unsubscribes?",
    a: [
      "They are added to your do-not-contact list immediately and are never emailed again from your account, on any sequence. Bounces and spam complaints go on the same list automatically.",
      "That list only ever grows. Nothing in the product takes an address off it, which is deliberate.",
    ],
    keywords: ["unsubscribe", "opt out", "bounce", "spam", "complaint"],
  },
  {
    id: "change-password",
    topic: "account",
    q: "How do I change my password or email address?",
    a: [
      "Both are on the Account and security screen. Changing your email sends a confirmation link to the new address, and the change only takes effect once you click it, so a typo cannot lock you out.",
    ],
    keywords: ["password", "email address", "login", "sign in", "reset"],
  },
  {
    id: "delete-account",
    topic: "account",
    q: "How do I delete my account?",
    a: [
      "On the Account and security screen, at the bottom. It asks for your password and for you to type the word DELETE, because it cannot be undone.",
      "Deleting removes your searches, your leads, your credit history, your API keys, your CRM connections and your email sequences. Any unused credits are lost and are not refundable.",
    ],
    keywords: ["delete", "close account", "remove", "gdpr", "erase"],
  },
  {
    id: "who-sees-data",
    topic: "data",
    q: "Who can see the leads I have opened?",
    a: [
      "Only you. Leads, searches and unlocks are keyed to your account and the database enforces that at the row level, not just in the interface.",
      "We do not sell your search history and we do not share which businesses you are working.",
    ],
    keywords: ["privacy", "private", "share", "sell", "gdpr"],
  },
  {
    id: "export",
    topic: "data",
    q: "Can I take my data with me?",
    a: [
      "Yes. Any search can be exported to CSV, and exporting a lead you have already opened is free and always will be.",
    ],
    keywords: ["export", "csv", "download", "portability"],
  },
];

/** Free-text search across question, answer and keywords. */
export function searchFaq(query: string, entries: FaqEntry[] = FAQ): FaqEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  // Every word has to appear somewhere in the entry. Matching on any word turns a
  // two-word query into most of the list, which reads as if search is broken.
  const words = q.split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    const hay = [e.q, ...e.a, ...(e.keywords ?? [])].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
