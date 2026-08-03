import { SUBSCRIPTION_PRICE_CENTS, CREDIT_PRICE_CENTS } from "@/lib/pricing";
import { siteUrl } from "@/lib/site-url";

// Structured data, so a search engine can describe the product without guessing.
//
// This is what produces a rich result rather than a blue link: the price, the rating
// slot, the FAQ accordion under the listing. It is also what an AI assistant reads
// when someone asks it to compare lead tools, which is quietly becoming a bigger
// referral path than the ten blue links.
//
// Everything here must be TRUE and visible on the page it sits on. Marking up a
// rating we do not have, or an FAQ that is not on the page, is a manual action from
// Google and the listing disappears entirely.

const SITE = siteUrl();

function Json({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // The content is ours, not user input. JSON.stringify escapes the quotes; the
      // replace closes the one hole that leaves, a literal </script> inside a string.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

/** Who we are. Sitewide, in the root layout. */
export function OrganizationSchema({ brand }: { brand: string }) {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        name: brand,
        url: SITE,
        logo: `${SITE}/icon.svg`,
        description:
          "Verified local business leads, checked at the moment you search and priced one credit per lead.",
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          url: `${SITE}/contact`,
          availableLanguage: "English",
        },
      }}
    />
  );
}

/** What the product is and what it costs. */
export function ProductSchema({ brand }: { brand: string }) {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: brand,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: SITE,
        description:
          "Find local businesses that need what you sell. Every phone and email is verified at search time, every lead is graded on the work it actually needs, and one credit opens one lead permanently.",
        offers: [
          {
            "@type": "Offer",
            name: "Platform access",
            price: (SUBSCRIPTION_PRICE_CENTS / 100).toFixed(2),
            priceCurrency: "USD",
            description: "Yearly access to the platform. Includes no credits.",
          },
          {
            "@type": "Offer",
            name: "Credit",
            price: (CREDIT_PRICE_CENTS / 100).toFixed(2),
            priceCurrency: "USD",
            description: "One credit opens one lead, permanently.",
          },
        ],
        featureList: [
          "Verified phone and email",
          "Confirmed still trading",
          "Opportunity grade out of 100",
          "Change detection between visits",
          "HubSpot and Salesforce push",
          "Email sequences",
          "CSV import and export",
          "Public API",
        ],
      }}
    />
  );
}

/**
 * The questions on the page, marked up.
 *
 * Only ever rendered beside the same questions in visible text. An FAQ schema whose
 * answers are not on the page is the single most common way sites get penalised for
 * structured data.
 */
export function FaqSchema({ items }: { items: { q: string; a: string }[] }) {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }}
    />
  );
}

/** The trail a search result shows above the title. */
export function BreadcrumbSchema({ trail }: { trail: { name: string; path: string }[] }) {
  return (
    <Json
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: trail.map((t, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: t.name,
          item: `${SITE}${t.path}`,
        })),
      }}
    />
  );
}
