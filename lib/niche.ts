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
  { label: "Medical & clinics", keywords: ["doctor", "medical", "clinic", "physician", "healthcare", "practice"], filters: ['"amenity"="doctors"', '"amenity"="clinic"', '"healthcare"="doctor"'] },
  { label: "Veterinary", keywords: ["vet", "veterinar", "animal hospital"], filters: ['"amenity"="veterinary"'] },
  { label: "Gyms & fitness", keywords: ["gym", "fitness", "yoga", "pilates", "crossfit", "workout"], filters: ['"leisure"="fitness_centre"', '"leisure"="sports_centre"', '"sport"="fitness"'] },
  { label: "Auto repair", keywords: ["auto", "mechanic", "car repair", "garage", "tire", "body shop"], filters: ['"shop"="car_repair"', '"shop"="tyres"'] },
  { label: "Car dealers", keywords: ["dealership", "car dealer", "auto dealer"], filters: ['"shop"="car"'] },
  { label: "Home services / trades", keywords: ["plumber", "plumbing", "hvac", "electrician", "roofing", "roofer", "contractor", "construction", "handyman", "landscaping"], filters: ['"craft"="plumber"', '"craft"="electrician"', '"craft"="hvac"', '"craft"="roofer"', '"craft"="carpenter"', '"office"="construction_company"', '"shop"="trade"'] },
  { label: "Real estate", keywords: ["real estate", "realtor", "realty", "property"], filters: ['"office"="estate_agent"', '"shop"="estate_agent"'] },
  { label: "Law firms", keywords: ["law", "lawyer", "attorney", "legal"], filters: ['"office"="lawyer"'] },
  { label: "Accounting & finance", keywords: ["accounting", "accountant", "cpa", "bookkeep", "tax", "financial"], filters: ['"office"="accountant"', '"office"="financial"', '"office"="tax_advisor"'] },
  { label: "Insurance", keywords: ["insurance"], filters: ['"office"="insurance"'] },
  { label: "Retail & boutiques", keywords: ["retail", "store", "boutique", "shop", "clothing", "apparel"], filters: ['"shop"="clothes"', '"shop"="boutique"', '"shop"="gift"'] },
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
  { label: "IT & software", keywords: ["software", "it company", "tech company", "development", "developer", "web design", "web development", "saas", "app development"], filters: ['"office"="it"', '"office"="telecommunication"'] },
];

export type ResolvedNiche = {
  label: string;
  filters: string[];
  generic: boolean;
};

export function resolveNiche(raw: string): ResolvedNiche {
  const q = raw.toLowerCase().trim();
  const scored = CATALOG.map((def) => ({
    def,
    hits: def.keywords.filter((k) => q.includes(k)).length,
  }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (scored.length) {
    // Merge filters from all matching categories (e.g. "restaurant pos" -> restaurants).
    const top = scored.filter((s) => s.hits === scored[0].hits).slice(0, 2);
    const filters = Array.from(new Set(top.flatMap((s) => s.def.filters)));
    const label = top.map((s) => s.def.label).join(" + ");
    return { label, filters, generic: false };
  }

  // Fallback: unknown niche. Search common business tags whose name contains the
  // niche words. This keeps the tool truly niche-agnostic.
  const word = q.split(/\s+/).filter((w) => w.length > 2)[0] || q;
  const nameRegex = escapeRegex(word);
  const filters = [
    `"shop"~".*"]["name"~"${nameRegex}",i`,
    `"office"~".*"]["name"~"${nameRegex}",i`,
    `"amenity"~".*"]["name"~"${nameRegex}",i`,
    `"craft"~".*"]["name"~"${nameRegex}",i`,
  ];
  return { label: `"${raw}" (name match)`, filters, generic: true };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
