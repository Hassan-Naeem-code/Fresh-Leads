// Turn a free-text niche ("restaurant pos", "dentists", "software development")
// into concrete OpenStreetMap tag filters used to find real businesses.
//
// Each entry: keywords the user might type -> OSM filters (Overpass tag selectors).
// A filter is a raw Overpass tag expression, e.g. '"amenity"="restaurant"'.

type NicheDef = { keywords: string[]; filters: string[]; label: string };

const CATALOG: NicheDef[] = [
  { label: "Restaurants", keywords: ["restaurant", "pos", "dining", "diner", "eatery", "food"], filters: ['"amenity"="restaurant"', '"amenity"="fast_food"'] },
  { label: "Cafes & coffee", keywords: ["cafe", "coffee", "coffeehouse", "espresso"], filters: ['"amenity"="cafe"'] },
  { label: "Bars & pubs", keywords: ["bar", "pub", "tavern", "nightclub", "brewery"], filters: ['"amenity"="bar"', '"amenity"="pub"', '"amenity"="biergarten"'] },
  { label: "Salons & beauty", keywords: ["salon", "beauty", "hair", "nails", "spa", "barber", "barbershop"], filters: ['"shop"="hairdresser"', '"shop"="beauty"', '"beauty"="nails"'] },
  { label: "Dental", keywords: ["dentist", "dental", "orthodont"], filters: ['"amenity"="dentist"', '"healthcare"="dentist"'] },
  // "practice" removed: it is a generic business word, not a medical one, and it made
  // "law practice" resolve to Medical & clinics + Law firms, returning doctors to
  // somebody looking for solicitors.
  { label: "Medical & clinics", keywords: ["doctor", "medical", "clinic", "physician", "healthcare"], filters: ['"amenity"="doctors"', '"amenity"="clinic"', '"healthcare"="doctor"'] },
  { label: "Veterinary", keywords: ["vet", "veterinar", "animal hospital"], filters: ['"amenity"="veterinary"'] },
  { label: "Gyms & fitness", keywords: ["gym", "fitness", "yoga", "pilates", "crossfit", "workout"], filters: ['"leisure"="fitness_centre"', '"leisure"="sports_centre"', '"sport"="fitness"'] },
  { label: "Auto repair", keywords: ["auto", "mechanic", "car repair", "garage", "tire", "body shop"], filters: ['"shop"="car_repair"', '"shop"="tyres"'] },
  { label: "Car dealers", keywords: ["dealership", "car dealer", "auto dealer"], filters: ['"shop"="car"'] },
  { label: "Home services / trades", keywords: ["plumber", "plumbing", "hvac", "electrician", "roofing", "roofer", "contractor", "construction", "handyman", "landscaping"], filters: ['"craft"="plumber"', '"craft"="electrician"', '"craft"="hvac"', '"craft"="roofer"', '"craft"="carpenter"', '"office"="construction_company"', '"shop"="trade"'] },
  { label: "Real estate", keywords: ["real estate", "realtor", "realty", "property"], filters: ['"office"="estate_agent"', '"shop"="estate_agent"'] },
  { label: "Law firms", keywords: ["law", "lawyer", "attorney", "legal"], filters: ['"office"="lawyer"'] },
  { label: "Accounting & finance", keywords: ["accounting", "accountant", "cpa", "bookkeep", "tax", "financial"], filters: ['"office"="accountant"', '"office"="financial"', '"office"="tax_advisor"'] },
  { label: "Insurance", keywords: ["insurance"], filters: ['"office"="insurance"'] },
  // "store" and "shop" removed, and this was the single most damaging entry in the
  // catalog. They are the generic nouns that end almost every retail query, so
  // "liquor store", "hardware store", "convenience store", "vape shop" and "print
  // shop" all matched HERE and were then narrowed by name against clothing tags:
  // a search for liquor stores looked for clothes shops called "liquor".
  //
  // Worse than useless, because matching sets generic:false, so there was no fallback
  // to the name search and no note telling the customer the category was a guess. The
  // specific trades those queries deserve are catalogued below instead.
  { label: "Retail & boutiques", keywords: ["retail", "boutique", "clothing", "apparel", "clothes"], filters: ['"shop"="clothes"', '"shop"="boutique"', '"shop"="gift"'] },
  { label: "Hotels & lodging", keywords: ["hotel", "motel", "lodging", "inn", "bnb", "bed and breakfast"], filters: ['"tourism"="hotel"', '"tourism"="motel"', '"tourism"="guest_house"'] },
  { label: "Pet services", keywords: ["pet", "groomer", "grooming", "dog", "kennel"], filters: ['"shop"="pet"', '"shop"="pet_grooming"'] },
  { label: "Childcare", keywords: ["daycare", "childcare", "preschool", "nursery"], filters: ['"amenity"="childcare"', '"amenity"="kindergarten"'] },
  { label: "Photography", keywords: ["photograph", "photo studio"], filters: ['"shop"="photo"', '"craft"="photographer"'] },
  { label: "Tattoo & piercing", keywords: ["tattoo", "piercing", "ink"], filters: ['"shop"="tattoo"'] },
  { label: "Florists", keywords: ["florist", "flower", "flowers"], filters: ['"shop"="florist"'] },
  { label: "Bakeries", keywords: ["bakery", "baker", "pastry", "patisserie"], filters: ['"shop"="bakery"', '"shop"="pastry"'] },
  { label: "Jewelry", keywords: ["jewelry", "jeweller", "jeweler"], filters: ['"shop"="jewelry"'] },
  { label: "Cleaning & laundry", keywords: ["cleaning", "laundry", "laundromat", "dry clean"], filters: ['"shop"="laundry"', '"shop"="dry_cleaning"'] },
  { label: "Optical & eyewear", keywords: ["optician", "optical", "eyewear", "eye doctor", "optometr"], filters: ['"shop"="optician"'] },
  { label: "Pharmacies", keywords: ["pharmacy", "chemist", "drugstore"], filters: ['"amenity"="pharmacy"'] },
  { label: "Furniture & decor", keywords: ["furniture", "home decor", "interior"], filters: ['"shop"="furniture"', '"shop"="interior_decoration"'] },
  { label: "Marketing agencies", keywords: ["marketing", "advertising", "seo", "branding", "creative agency", "ad agency"], filters: ['"office"="advertising_agency"', '"office"="marketing"'] },
  // Bare "development" removed: it belongs to property and land far more often than
  // to software, and it sent "property development" to office=it.
  { label: "IT & software", keywords: ["software", "it company", "tech company", "software development", "software developer", "web design", "web development", "saas", "app development"], filters: ['"office"="it"', '"office"="telecommunication"'] },
  // ---------------------------------------------------------------------------
  // Everything below was added after measuring how many common local trades had no
  // category at all: 20 of 30 probed fell through to the name-match fallback, which
  // finds a fraction of what a tag selector does.
  //
  // EVERY TAG HERE WAS VERIFIED against real OpenStreetMap usage before being written
  // down (test/tools/verify-osm-tags.mjs). That is not ceremony. OSM tagging is
  // conventional rather than specified, and the conventions are not guessable:
  // shop=massage is real with 36,000 uses while shop=pest_control is a mistake 300
  // people made, and healthcare=chiropractor, which sounds obviously correct, has ten
  // uses in the entire world. A confidently wrong tag returns nothing and reads as a
  // broken product, so the trades whose tag did not survive verification (chiropractic,
  // pest control, towing) are deliberately absent and keep the name-match fallback.
  // ---------------------------------------------------------------------------
  { label: "Physical therapy", keywords: ["physio", "physical therapy", "physiotherap", "rehab"], filters: ['"healthcare"="physiotherapist"'] },
  { label: "Massage & bodywork", keywords: ["massage", "bodywork", "masseuse"], filters: ['"shop"="massage"'] },
  { label: "Car wash", keywords: ["car wash", "carwash", "auto detail", "detailing"], filters: ['"amenity"="car_wash"'] },
  { label: "Locksmiths", keywords: ["locksmith", "lockout", "key cutting"], filters: ['"shop"="locksmith"', '"craft"="locksmith"', '"craft"="key_cutter"'] },
  { label: "Self storage", keywords: ["storage", "self storage", "storage unit"], filters: ['"shop"="storage_rental"'] },
  { label: "Print & signs", keywords: ["printer", "printing", "print", "sign", "signage", "copy", "banner"], filters: ['"shop"="copyshop"', '"shop"="printing"', '"craft"="signmaker"', '"craft"="printer"'] },
  { label: "Liquor stores", keywords: ["liquor", "wine", "beer", "spirits", "bottle", "package"], filters: ['"shop"="alcohol"', '"shop"="wine"', '"shop"="beverages"'] },
  { label: "Convenience stores", keywords: ["convenience", "corner", "bodega", "mini mart"], filters: ['"shop"="convenience"'] },
  { label: "Grocery", keywords: ["grocery", "grocer", "supermarket", "produce", "market"], filters: ['"shop"="supermarket"', '"shop"="greengrocer"'] },
  { label: "Butchers & delis", keywords: ["butcher", "deli", "delicatessen", "meat"], filters: ['"shop"="butcher"', '"shop"="deli"'] },
  { label: "Hardware & DIY", keywords: ["hardware", "diy", "lumber", "building supply", "paint store"], filters: ['"shop"="hardware"', '"shop"="doityourself"', '"shop"="paint"'] },
  { label: "Garden centers", keywords: ["garden center", "garden centre", "nursery plant", "landscape supply"], filters: ['"shop"="garden_centre"'] },
  { label: "Computer & phone repair", keywords: ["computer repair", "phone repair", "pc repair", "it repair", "screen repair"], filters: ['"shop"="computer"', '"shop"="mobile_phone"'] },
  { label: "Bike shops", keywords: ["bike", "bicycle", "cycle"], filters: ['"shop"="bicycle"'] },
  { label: "Sporting goods", keywords: ["sporting", "sports store", "outdoor gear", "athletic"], filters: ['"shop"="sports"', '"shop"="outdoor"'] },
  { label: "Music", keywords: ["music", "instrument", "guitar", "piano"], filters: ['"shop"="musical_instrument"', '"amenity"="music_school"'] },
  // amenity=school is deliberately EXCLUDED. It is public schools, not businesses, and
  // it would bury a tutoring search under every elementary school in the county.
  { label: "Tutoring & training", keywords: ["tutor", "tutoring", "training", "language school", "test prep"], filters: ['"office"="educational_institution"', '"amenity"="language_school"'] },
  { label: "Driving schools", keywords: ["driving school", "driving instructor", "driver training"], filters: ['"amenity"="driving_school"'] },
  { label: "Funeral homes", keywords: ["funeral", "mortuary", "crematorium", "undertaker"], filters: ['"shop"="funeral_directors"', '"amenity"="funeral_hall"'] },
  { label: "Travel agencies", keywords: ["travel agency", "travel agent", "tour operator"], filters: ['"shop"="travel_agency"'] },
  { label: "Events & catering", keywords: ["catering", "caterer", "event venue", "banquet", "party rental"], filters: ['"amenity"="events_venue"', '"craft"="caterer"', '"shop"="party"'] },
  { label: "Ice cream & desserts", keywords: ["ice cream", "gelato", "dessert", "candy", "chocolate", "confection"], filters: ['"amenity"="ice_cream"', '"shop"="confectionery"', '"shop"="chocolate"'] },
  { label: "Pool services", keywords: ["pool service", "pool cleaning", "swimming pool", "pool builder"], filters: ['"shop"="swimming_pool"'] },
  { label: "Painters & decorators", keywords: ["painter", "painting", "decorator", "plasterer", "drywall"], filters: ['"craft"="painter"', '"craft"="plasterer"'] },
  { label: "Flooring & tile", keywords: ["flooring", "floor", "tile", "tiling", "carpet", "hardwood"], filters: ['"shop"="flooring"', '"shop"="carpet"', '"craft"="tiler"'] },
  { label: "Windows & glass", keywords: ["window", "glass", "glazier", "glazing", "windshield"], filters: ['"craft"="window_construction"', '"craft"="glaziery"'] },
  { label: "Masonry & stone", keywords: ["masonry", "mason", "stonework", "stonemason", "concrete"], filters: ['"craft"="stonemason"'] },
  { label: "Metalwork & welding", keywords: ["welding", "welder", "metalwork", "fabrication", "blacksmith", "machine shop"], filters: ['"craft"="metal_construction"', '"craft"="blacksmith"', '"craft"="welder"'] },
  { label: "Staffing agencies", keywords: ["staffing", "recruiting", "recruitment", "employment agency", "temp agency"], filters: ['"office"="employment_agency"'] },
  { label: "Security services", keywords: ["security", "alarm", "surveillance", "guard"], filters: ['"office"="security"', '"shop"="security"'] },
  { label: "Tailors & alterations", keywords: ["tailor", "alterations", "seamstress", "embroidery"], filters: ['"craft"="tailor"'] },
  { label: "Upholstery & cabinetry", keywords: ["upholstery", "upholsterer", "cabinet", "cabinetry", "millwork"], filters: ['"craft"="upholsterer"', '"craft"="cabinet_maker"'] },
  { label: "Antiques & resale", keywords: ["antique", "thrift", "consignment", "second hand", "resale", "vintage"], filters: ['"shop"="antiques"', '"shop"="second_hand"', '"shop"="charity"'] },
  { label: "Bookstores", keywords: ["bookstore", "book", "bookshop"], filters: ['"shop"="books"'] },
  { label: "Toy & craft stores", keywords: ["toy", "hobby", "craft store", "fabric", "quilting", "yarn"], filters: ['"shop"="toys"', '"shop"="craft"', '"shop"="fabric"'] },
  { label: "Smoke & vape", keywords: ["smoke", "vape", "tobacco", "cigar", "head"], filters: ['"shop"="tobacco"', '"shop"="e-cigarette"'] },
  { label: "Dispensaries", keywords: ["dispensary", "cannabis", "marijuana", "cbd"], filters: ['"shop"="cannabis"'] },
  { label: "Senior care", keywords: ["senior", "assisted living", "nursing home", "elder", "home care"], filters: ['"amenity"="social_facility"'] },
  { label: "Car rental", keywords: ["car rental", "rent a car", "vehicle rental", "truck rental"], filters: ['"amenity"="car_rental"'] },
  { label: "Auto parts", keywords: ["auto parts", "car parts", "parts store", "spares"], filters: ['"shop"="car_parts"'] },
  { label: "Motorcycle & powersports", keywords: ["motorcycle", "powersports", "scooter", "moped"], filters: ['"shop"="motorcycle"'] },
  { label: "Boats & marine", keywords: ["boat", "marine", "marina", "yacht"], filters: ['"shop"="boat"'] },
  { label: "Appliance repair", keywords: ["appliance", "washer repair", "fridge repair", "hvac repair"], filters: ['"shop"="appliance"', '"shop"="repair"', '"craft"="electronics_repair"'] },
  { label: "Banks & credit unions", keywords: ["bank", "credit union", "savings"], filters: ['"amenity"="bank"'] },
];

export type ResolvedNiche = {
  label: string;
  filters: string[];
  generic: boolean;
  /**
   * The words the customer typed that the category did not account for, e.g. "sushi"
   * in "best sushi restaurant". Kept so the caller can say what was narrowed on.
   */
  qualifier: string | null;
};

// Words that carry no meaning for a search. "best sushi restaurant" and "sushi
// restaurant" are the same request, and treating "best" as a qualifier would narrow
// the search to businesses with "best" in their name.
const NOISE = new Set([
  "best", "top", "good", "great", "local", "nearby", "near", "me", "the", "a", "an",
  "in", "of", "for", "and", "my", "our", "your", "some", "any", "all", "new",
  "small", "big", "large", "independent", "cheap", "affordable", "quality",
  "companies", "company", "business", "businesses", "services", "service", "firms",
  "firm", "shops", "shop", "places", "place", "providers", "provider",
  // The nouns that end a retail or professional query. Removing them from the
  // CATEGORY keywords stopped "liquor store" matching clothing, but they survived as
  // qualifiers and narrowed on the business NAME instead: "pet store" became pet shops
  // called "store", and "law practice" became solicitors called "practice". A word
  // that means "a business of some kind" can never be a useful narrowing term.
  "store", "stores", "practice", "practices", "outlet", "outlets", "centre", "center",
  // Ranking words. "top rated dentists" narrowed to dentists with "rated" in their
  // name, which is nobody. These describe how a customer feels about a result, not
  // what they are looking for.
  "rated", "reviewed", "recommended", "trusted", "reliable", "professional",
  "experienced", "certified", "licensed", "award", "winning", "leading", "premier",
]);

/**
 * Cuisines OpenStreetMap actually tags, so a food qualifier can use the real tag
 * rather than guessing from the business name.
 *
 * A name match finds "Tokyo Sushi" and misses "Nobu". The cuisine tag finds both,
 * because somebody recorded what the restaurant serves rather than what it is called.
 */
const CUISINES = new Set([
  "sushi", "japanese", "chinese", "thai", "indian", "italian", "pizza", "mexican",
  "vietnamese", "korean", "greek", "french", "spanish", "turkish", "lebanese",
  "american", "burger", "barbecue", "bbq", "seafood", "steak", "vegan", "vegetarian",
  "ramen", "noodle", "sandwich", "breakfast", "brunch", "bakery", "dessert", "ice_cream",
]);

export function resolveNiche(raw: string): ResolvedNiche {
  const q = raw.toLowerCase().trim();
  // WHOLE WORDS, not substrings.
  //
  // q.includes(k) meant "barbers" matched the keyword "bar", so a search for barbers
  // returned every bar and pub in the city alongside the hairdressers. Prefixes are
  // allowed deliberately, because "dentists" has to match "dentist" and "plumbing"
  // has to match "plumber", but a keyword may only start at a word boundary.
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);

  // A keyword matches a word only when the leftover is a plural or a verb ending.
  // "bars" matches "bar" because the leftover is "s"; "barbers" does not, because the
  // leftover is "bers". A bare prefix rule got that wrong in both directions: it
  // returned bars for barbers, then barbers for bars.
  const ENDINGS = new Set(["", "s", "es", "ies"]);
  const matches = (k: string) => {
    // A keyword containing a space is a PHRASE and has to be looked for in the whole
    // query. Checking it word by word means "car dealer" never matches "car
    // dealership", so only "dealership" was consumed and "car" survived as a
    // qualifier, narrowing car dealers to the ones with "car" in their name.
    if (k.includes(" ")) return q.includes(k);
    return words.some((w) => {
      if (w === k) return true;
      if (w.startsWith(k) && ENDINGS.has(w.slice(k.length))) return true;
      if (k.startsWith(w) && ENDINGS.has(k.slice(w.length))) return true;
      // Different endings on the same root: plumbing and plumber.
      //
      // A shared five-letter prefix alone is not enough, and "pest control" proved it:
      // "control" and "contractor" both start "contr", so a pest control search
      // resolved to Home services / trades and looked for contractors named "pest".
      //
      // What separates a real shared root from a coincidence is what is LEFT once the
      // root is removed. plumbing/plumber leave "ing" and "er", which are endings.
      // control/contractor leave "ol" and "actor", and "actor" is another word. So the
      // remainder on both sides has to be short enough to be a suffix.
      if (k.length < 5 || w.length < 5) return false;
      let i = 0;
      while (i < k.length && i < w.length && k[i] === w[i]) i++;
      if (i < 5) return false;

      const kLeft = k.length - i;
      const wLeft = w.length - i;
      // One word contains the other whole: "veterinar" inside "veterinarians". That is
      // an inflection, not a coincidence, so a longer tail is fine.
      if (kLeft === 0 || wLeft === 0) return Math.max(kLeft, wLeft) <= 5;
      // Both sides diverge, which is where the false matches live. Only short endings
      // are credible: "ing" and "er" are suffixes, "actor" is another word.
      return kLeft <= 3 && wLeft <= 3;
    });
  };

  const scored = CATALOG.map((def) => ({
    def,
    hits: def.keywords.filter(matches).length,
    matched: def.keywords.filter(matches),
  }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (scored.length) {
    const top = scored.filter((s) => s.hits === scored[0].hits).slice(0, 2);
    const filters = Array.from(new Set(top.flatMap((s) => s.def.filters)));
    const label = top.map((s) => s.def.label).join(" + ");

    // WHAT DID THE CATEGORY NOT ACCOUNT FOR?
    //
    // "best sushi restaurant" matched Restaurants on the word "restaurant" and then
    // threw "sushi" away, so the search returned every restaurant in the city. Same
    // for "car accident law firm", which returned every law firm. The qualifier is
    // usually the entire point of what was typed.
    // Multi word keywords like "car dealer" have to contribute BOTH words, or "car
    // dealership" leaves "car" behind as a qualifier and narrows a car dealer search
    // to dealers with "car" in the name.
    const consumed = new Set(
      top.flatMap((s) => s.matched).flatMap((k) => [k, ...k.split(/\s+/)])
    );
    const leftover = q
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter((w) => w.length > 2)
      .filter((w) => !NOISE.has(w))
      .filter((w) => ![...consumed].some((k) => k.includes(w) || w.includes(k)));

    if (leftover.length === 0) {
      return { label, filters, generic: false, qualifier: null };
    }

    const qualifier = leftover.join(" ");
    const regex = escapeRegex(leftover.join("|"));

    // A known cuisine gets the real tag. Everything else narrows on the name, which
    // is weaker but still far closer to what was asked for than ignoring it.
    const cuisineWords = leftover.filter((w) => CUISINES.has(w));
    const narrowed = filters.flatMap((f) =>
      cuisineWords.length > 0
        ? [
            `${f}]["cuisine"~"${escapeRegex(cuisineWords.join("|"))}",i`,
            `${f}]["name"~"${regex}",i`,
          ]
        : [`${f}]["name"~"${regex}",i`]
    );

    return {
      label: `${label}, ${qualifier}`,
      filters: narrowed,
      generic: false,
      qualifier,
    };
  }

  // Fallback: unknown niche. Search common business tags whose name contains the
  // niche words. This keeps the tool truly niche-agnostic.
  const fallbackWords = q.split(/\s+/).filter((w) => w.length > 2 && !NOISE.has(w));
  const word = fallbackWords[0] || q;
  const nameRegex = escapeRegex(word);
  const filters = [
    `"shop"~".*"]["name"~"${nameRegex}",i`,
    `"office"~".*"]["name"~"${nameRegex}",i`,
    `"amenity"~".*"]["name"~"${nameRegex}",i`,
    `"craft"~".*"]["name"~"${nameRegex}",i`,
  ];
  return { label: `"${raw}" (name match)`, filters, generic: true, qualifier: word };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
