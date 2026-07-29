// Which vendors and platforms a business already runs on.
//
// This is the signal a reseller actually buys. A Shift4 rep does not care whether a
// restaurant's website is pretty; they care that it is taking card payments through
// Toast today, because that is a switchable contract and a concrete opening line:
// "you're on Toast at 2.6% plus 15 cents, I can beat that."
//
// We were already detecting most of these in lib/audit.ts, but only to answer "can a
// customer book online?", and then throwing the vendor name away. Same fetch, same
// HTML, far more valuable output.

export type VendorCategory =
  /** Point of sale / payment terminal. */
  | "pos"
  /** Online payment processing. */
  | "payments"
  /** Food ordering / delivery marketplace. */
  | "ordering"
  /** Appointment booking / scheduling. */
  | "booking"
  /** Website builder or CMS. */
  | "builder"
  /** Analytics or advertising pixel. */
  | "ads";

export type Vendor = {
  /** Stable key, e.g. "square". */
  id: string;
  /** Display name, e.g. "Square". */
  name: string;
  category: VendorCategory;
  /**
   * Is this a contract a competitor could displace? A POS or payments provider is;
   * WordPress is not. Drives the "already on a switchable vendor" signal.
   */
  switchable: boolean;
  /** Substrings to look for in the page HTML, lowercased. */
  markers: string[];
};

// Ordered roughly by commercial usefulness. Markers are deliberately specific: a
// false "they use Square" is worse than no detection, because a rep will open a call
// with it.
export const VENDORS: Vendor[] = [
  // --- POS / terminals: the payments reseller's target list ---
  { id: "toast", name: "Toast", category: "pos", switchable: true,
    markers: ["toasttab.com", "toastwebstore", "order.toasttab"] },
  { id: "square", name: "Square", category: "pos", switchable: true,
    markers: ["squareup.com", "square.site", "squarecdn.com", "square-web-payments"] },
  { id: "clover", name: "Clover", category: "pos", switchable: true,
    markers: ["clover.com", "clover.net", "cloverapp"] },
  { id: "lightspeed", name: "Lightspeed", category: "pos", switchable: true,
    markers: ["lightspeedhq.com", "lightspeedapp.com"] },
  { id: "spoton", name: "SpotOn", category: "pos", switchable: true,
    markers: ["spoton.com", "spothopperapp"] },
  { id: "revel", name: "Revel Systems", category: "pos", switchable: true,
    markers: ["revelsystems.com"] },
  { id: "touchbistro", name: "TouchBistro", category: "pos", switchable: true,
    markers: ["touchbistro.com"] },

  // --- Online payments ---
  { id: "stripe", name: "Stripe", category: "payments", switchable: true,
    markers: ["js.stripe.com", "stripe.com/v3", "checkout.stripe.com"] },
  { id: "paypal", name: "PayPal", category: "payments", switchable: true,
    markers: ["paypal.com/sdk", "paypalobjects.com", "paypal.me"] },
  { id: "shopify_payments", name: "Shopify", category: "payments", switchable: true,
    markers: ["cdn.shopify.com", "shopifycloud", "myshopify.com"] },
  { id: "authorize_net", name: "Authorize.net", category: "payments", switchable: true,
    markers: ["authorize.net"] },

  // --- Ordering / delivery marketplaces (they are paying commission today) ---
  { id: "doordash", name: "DoorDash", category: "ordering", switchable: true,
    markers: ["doordash.com"] },
  { id: "ubereats", name: "Uber Eats", category: "ordering", switchable: true,
    markers: ["ubereats.com"] },
  { id: "grubhub", name: "Grubhub", category: "ordering", switchable: true,
    markers: ["grubhub.com"] },
  { id: "menufy", name: "Menufy", category: "ordering", switchable: true,
    markers: ["menufy.com"] },
  { id: "chownow", name: "ChowNow", category: "ordering", switchable: true,
    markers: ["chownow.com"] },
  { id: "slice", name: "Slice", category: "ordering", switchable: true,
    markers: ["slicelife.com"] },

  // --- Booking / scheduling ---
  { id: "opentable", name: "OpenTable", category: "booking", switchable: true,
    markers: ["opentable.com"] },
  { id: "resy", name: "Resy", category: "booking", switchable: true, markers: ["resy.com"] },
  { id: "booksy", name: "Booksy", category: "booking", switchable: true, markers: ["booksy.com"] },
  { id: "vagaro", name: "Vagaro", category: "booking", switchable: true, markers: ["vagaro.com"] },
  { id: "styleseat", name: "StyleSeat", category: "booking", switchable: true, markers: ["styleseat.com"] },
  { id: "mindbody", name: "Mindbody", category: "booking", switchable: true, markers: ["mindbodyonline.com"] },
  { id: "calendly", name: "Calendly", category: "booking", switchable: true, markers: ["calendly.com"] },
  { id: "acuity", name: "Acuity Scheduling", category: "booking", switchable: true,
    markers: ["acuityscheduling.com", "squarespacescheduling.com"] },
  { id: "zocdoc", name: "Zocdoc", category: "booking", switchable: true, markers: ["zocdoc.com"] },
  { id: "fresha", name: "Fresha", category: "booking", switchable: true, markers: ["fresha.com"] },

  // --- Website builders: not a contract to displace, but tells you who built it
  // and how much resistance a rebuild will meet. ---
  { id: "wix", name: "Wix", category: "builder", switchable: false,
    markers: ["wix.com", "wixstatic.com", "parastorage.com"] },
  { id: "squarespace", name: "Squarespace", category: "builder", switchable: false,
    markers: ["squarespace.com", "squarespace-cdn.com"] },
  { id: "wordpress", name: "WordPress", category: "builder", switchable: false,
    markers: ["wp-content", "wp-includes", "wp-json"] },
  { id: "godaddy", name: "GoDaddy Website Builder", category: "builder", switchable: false,
    markers: ["godaddysites.com", "img1.wsimg.com"] },
  { id: "weebly", name: "Weebly", category: "builder", switchable: false,
    markers: ["weebly.com", "weeblysite.com"] },
  { id: "duda", name: "Duda", category: "builder", switchable: false,
    markers: ["dudamobile.com", "multiscreensite.com"] },

  // --- Ads / analytics ---
  { id: "google_ads", name: "Google Ads", category: "ads", switchable: false,
    markers: ["googleadservices.com", "googlesyndication.com", "aw-conversion"] },
  { id: "meta_ads", name: "Meta Pixel", category: "ads", switchable: false,
    markers: ["connect.facebook.net", "fbq("] },
];

/** Everything detectable in a page's HTML. `lower` must be the lowercased HTML. */
export function detectVendors(lower: string): Vendor[] {
  return VENDORS.filter((v) => v.markers.some((m) => lower.includes(m)));
}

/** The vendors a competitor could realistically displace. */
export function switchableVendors(vendors: Vendor[]): Vendor[] {
  return vendors.filter((v) => v.switchable);
}

export function vendorsInCategories(vendors: Vendor[], categories: VendorCategory[]): Vendor[] {
  return vendors.filter((v) => categories.includes(v.category));
}

export function vendorById(id: string): Vendor | undefined {
  return VENDORS.find((v) => v.id === id);
}

/** Compact form stored on a Lead and shipped to the browser. */
export type VendorMatch = { id: string; name: string; category: VendorCategory; switchable: boolean };

export const toVendorMatch = (v: Vendor): VendorMatch => ({
  id: v.id,
  name: v.name,
  category: v.category,
  switchable: v.switchable,
});
