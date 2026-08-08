// FRANCHISES AND BIG BRANDS, which this product deliberately does not sell.
//
// Extracted from lib/sources/overpass-source.ts so the owned index applies the SAME
// list. It has to be the same list rather than a similar one: a customer searching an
// indexed city and an unindexed one must get the same kind of businesses, and the
// difference between "we filter chains" and "we filter chains except where we happen
// to hold an index" is the sort of inconsistency nobody reports and everybody notices.
//
// Applied at QUERY time rather than at ingest, so adding a brand takes effect
// immediately instead of waiting for several million rows to be re-imported.

// Big-brand filter: these are franchises/chains, not the independent local
// businesses this tool targets.
const CHAINS = [
  "mcdonald", "burger king", "wendy", "taco bell", "subway", "chipotle",
  "starbucks", "dunkin", "panera", "chick-fil-a", "chick fil a", "popeyes",
  "kfc", "domino", "pizza hut", "little caesar", "jet's pizza", "jets pizza",
  "wingstop", "a&w", "dairy queen", "dave's hot chicken", "daves hot chicken",
  "papa john", "papa murphy", "marco's pizza", "hungry howie", "cottage inn",
  "arby", "sonic drive", "hardee", "carl's jr", "jimmy john", "jersey mike",
  "five guys", "culver", "white castle", "checkers", "del taco", "del boca",
  "panda express", "raising cane", "in-n-out", "whataburger", "tim horton",
  "qdoba", "moe's southwest", "firehouse subs", "buffalo wild wings",
  "applebee", "olive garden", "chili's", "ihop", "denny", "outback",
  "red lobster", "red robin", "texas roadhouse", "cracker barrel", "tgi friday",
  "national coney", "leo's coney", "coney island",
  "walmart", "target", "costco", "sam's club", "home depot", "lowe", "menards",
  "best buy", "kroger", "meijer", "aldi", "dollar general", "dollar tree",
  "family dollar", "7-eleven", "circle k", "speedway", "marathon",
  "cvs", "walgreens", "rite aid", "planet fitness", "anytime fitness",
  "la fitness", "orangetheory", "great clips", "supercuts", "sport clips",
  "jiffy lube", "valvoline", "midas", "pep boys", "aamco", "monro",
  "h&r block", "liberty tax", "state farm", "allstate", "geico", "progressive",
  "u-haul", "enterprise rent", "hertz", "fedex", "ups store", "ace hardware",
  "at&t", "verizon", "t-mobile", "comcast", "xfinity", "chase bank",
  "bank of america", "wells fargo", "pnc bank", "fifth third", "huntington bank",
];

/** Is this a franchise or big brand rather than an independent local business? */
export function isChain(name: string): boolean {
  const n = name.toLowerCase();
  return CHAINS.some((c) => n.includes(c));
}
