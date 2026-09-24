# products.salo.uk

Build the public product pages. Studio (admin.salo.uk, repo `salo-studio`) is the only place content is edited. This site reads that data and logs views. It does not write cards.

Companion brief: `PRD-products-site-2026-09-24.md`. The data contract below is what Studio actually shipped. Where that PRD still says `?c=`, use `?t=`. Studio copies links as `https://products.salo.uk/[slug]?t=[token]`.

Build the working version first (Phase 1). A later design pass can change how the page looks, not the sections or the data.

## Credentials

Server only. Do not put these in `NEXT_PUBLIC_*` and do not import the Supabase client into client components.

```
SUPABASE_URL=https://hlmfxwgbmrlmaueyyskn.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsbWZ4d2dibXJsbWF1ZXl5c2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3NDU2MDcsImV4cCI6MjA4MDMyMTYwN30.g54_xpXgaChmGooJu1hIQC5eFm_-Vacb_Fc3xuKuFA4
REVALIDATE_SECRET=
```

`REVALIDATE_SECRET` is a secret you generate. The same value must be set on Studio as `PRODUCTS_REVALIDATE_SECRET`, and Studio’s `PRODUCTS_REVALIDATE_URL` must be this site’s revalidation endpoint. Neither is set on Studio yet.

Do not use Studio’s service role key. The anon key cannot read the tables. It can only call the three functions below. That is the whole data API.

The functions exist only after Studio migration `085_product_cards.sql` has been applied. If a call says the function does not exist, that migration has not been run.

```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const { data: card } = await supabase.rpc('get_product_card', { p_slug: slug })
const { data: cards } = await supabase.rpc('list_product_cards')
await supabase.rpc('log_product_card_view', {
  p_slug: slug,
  p_token: token,                 // omit when there is no token
  p_referrer_host: 'linkedin.com' // hostname only, no path or scheme
})
```

`log_product_card_view` returns nothing. A successful call comes back as `data: null` and `error: null`.

## Routes

| URL | Behaviour |
| --- | --- |
| `/` | Index of published cards only, from `list_product_cards()`. |
| `/[slug]` | One card from `get_product_card`. `null` is a 404 (draft or unknown slug). |
| `/[slug]?t=[token]` | Log the view with the token, then redirect to `/[slug]` so the token is not left in the address bar. |

Unlisted cards do not appear on `/`, but `/[slug]` still renders them. That is how a private link works.

`status: "retired"` is still a 200. Show a “no longer offered” state and the related cards. Do not 404 it.

There is no checkout, no account, and no editor.

## get_product_card

Returns one JSON object, or `null`.

```ts
type PricingModel = 'fixed' | 'flexi'
type CtaKind = 'book_call' | 'reply_email' | 'flexi_brief'
type ItemSection = 'choose_when' | 'approach' | 'outcome' | 'terms' | 'faq'
type ExampleKind = 'image' | 'video' | 'logo' | 'case_study' | 'quote'
type CardStatus = 'unlisted' | 'published' | 'retired'

interface ProductCard {
  slug: string
  name: string
  category: string
  status: CardStatus
  decision_statement: string
  summary: string
  pricing_model: PricingModel
  price_amount: number | null
  currency: 'GBP' | 'USD'
  price_basis: string          // e.g. "ex VAT"
  payment_terms: string
  price_note: string | null
  credit_estimate: number | null
  flexi_service_title: string | null
  flexi_service_category: string | null
  timeline_text: string
  cta_kind: CtaKind
  cta_target: string           // booking URL, email, or brief URL
  indexable: boolean           // default false
  meta_title: string | null
  meta_description: string | null
  og_image_path: string | null
  published_at: string | null
  updated_at: string
  cover_image_url: string | null
  cover_image_alt: string | null
  cover_image_source: 'client' | 'sample' | null
  items: { section: ItemSection; title: string; body: string; sort_order: number }[]
  examples: {
    kind: ExampleKind
    title: string
    caption: string
    storage_path: string | null
    url: string | null
    company_name: string | null
    case_study_path: string | null
    sort_order: number
  }[]
  related: { slug: string; name: string; category: string; summary: string; sort_order: number }[]
}
```

`examples` are already filtered to signed-off proof. Logos and quotes without a client name are already removed. If `examples` is empty, hide the section. Do not show placeholders.

`related` contains published cards only.

`cover_image_url`, `cover_image_alt` and `cover_image_source` are null together when the card has no public cover. A sample is returned as soon as it is saved. Client work (`cover_image_source: "client"`) is returned only after someone in Studio has signed it off. `cover_image_url` is already a full public URL. This is separate from `og_image_path`, which is still only a storage path for the link preview.

A card is one pricing model, never both.

- `fixed`: show `price_amount` in `currency` (en-GB), then `price_basis`, then `payment_terms`. Show `price_note` when it is set (for example “additional pages £80 each”). `credit_estimate` is null.
- `flexi`: show `credit_estimate` as “1 credit” or “N credits”. There is no pound price. Say that it is paid from Flexi-Design credits and link to the Flexi-Design packs. Confirm that URL with Carl before hardcoding it. `flexi_service_title` is the catalogue name.

Group `items` by `section`. They are separate lists, not rows of a grid. Within a section, keep `sort_order`.

| section | On the page |
| --- | --- |
| `choose_when` | Choose this when |
| `approach` | How we do it |
| `outcome` | What you receive |
| `terms` | Terms. Hide the section if there are none. |
| `faq` | Questions. `title` is the question, `body` is the answer. Hide the section if there are none. |

## list_product_cards

Returns a JSON array, already ordered. Published cards only.

```ts
interface ProductCardSummary {
  slug: string
  name: string
  category: string
  summary: string
  pricing_model: 'fixed' | 'flexi'
  price_amount: number | null
  currency: string
  price_basis: string
  price_note: string | null
  credit_estimate: number | null
  flexi_service_title: string | null
  timeline_text: string
  sort_order: number
  cover_image_url: string | null
  cover_image_alt: string | null
  cover_image_source: 'client' | 'sample' | null
}
```

## Page structure

Top to bottom. The first screen and a half, on a phone, must show what the product is, what it costs, and how long it takes.

1. Header. Salo logo linking to https://salo.uk. A CTA that stays visible.
2. Hero. Name, then `decision_statement`. Under that, three facts: price or credits, `timeline_text`, and payment terms (fixed cards only).
3. Choose this when.
4. How we do it.
5. What you receive.
6. Work examples, or nothing.
7. Terms, if any.
8. FAQ, if any.
9. Next step. Button label from `cta_kind`: “Book a call”, “Reply by email”, “Open a Flexi-Design brief”. The destination is `cta_target`. An email target is a `mailto:` link.
10. Related products, linking to their slugs.
11. Footer. One line on who Salo is, a link to https://salo.uk, and the privacy notice. Until Sarah confirms, link to the privacy notice on salo.uk rather than writing a new one here.

The page often arrives with no surrounding context. Say who Salo is in one line.

Add a print stylesheet so the page can be saved as a PDF. No client login.

## Images

`storage_path` and `og_image_path` are paths in the public `product-cards` bucket. Encode each segment.

```
https://hlmfxwgbmrlmaueyyskn.supabase.co/storage/v1/object/public/product-cards/{path}
```

`url` on an example is a normal link, separate from the file. `case_study_path` is a path such as `case-studies/projects/…`. Do not invent a public URL for it. Show the caption and title. Link out only when `url` is set.

For the link preview (iMessage, Slack, LinkedIn, Gmail): use the uploaded `og_image_path` when it is set. Otherwise generate an image from the card name, summary, and Salo brand tokens. `meta_title` falls back to the product name. `meta_description` falls back to `summary`.

## Views

Log on the server, once per page load.

- Request has `t`: call `log_product_card_view` with that token and the referrer hostname, then redirect to the same path with `t` removed. The redirect must not log a second view.
- Request has no token: log one untracked view (`p_token` omitted).

A bad, expired, or inactive token still loads the page. Studio records it as an untracked visit. Do not show an error.

Pass only the referrer hostname (`linkedin.com`), never a path, query string, or IP. Do not set analytics cookies or add a tracking pixel. This view log is the only tracking.

Studio does not return who sent the link. Do not query `product_card_links` or any other table. Leave the sender’s name off the page until Studio adds a function for it.

## Revalidation

Studio POSTs here after a published, unlisted, or retired card is saved.

```
POST /api/revalidate
Authorization: Bearer <REVALIDATE_SECRET>
Content-Type: application/json

{ "slug": "ux-audit" }
```

Reject anything else with 401. On success, revalidate `/[slug]` and `/`, and respond 200. Studio waits up to 8 seconds and treats a non-200 as “saved in Studio, but the site did not refresh”.

Then set on the Studio Vercel project:

```
PRODUCTS_REVALIDATE_URL=https://products.salo.uk/api/revalidate
PRODUCTS_REVALIDATE_SECRET=<the same secret>
```

`PRODUCTS_SITE_URL` on Studio defaults to `https://products.salo.uk`. Set it only if the host differs.

## SEO

`indexable` defaults to false. Those pages are `noindex`. Only cards with `indexable: true` and `status: "published"` go in the sitemap. Unlisted and retired cards are `noindex` even if the flag is on.

Canonical URL is `https://products.salo.uk/[slug]`.

## Phase 1 is done when

- `/` lists published cards, and a published card renders every section it has data for.
- An unlisted slug renders. A draft slug 404s. A retired slug shows “no longer offered” and related cards.
- `?t=` logs a view and the address bar ends up without the token. A second request is not logged for that same visit.
- A link pasted into Slack shows the name, summary, and a preview image.
- The revalidation endpoint refreshes a slug within a minute of Studio saving it.
- No Supabase key is in the browser bundle. Lighthouse performance and accessibility are 90+ on mobile.

## Out of scope

Editing content, checkout, client logins, moving the pages onto salo.uk, and any analytics beyond the view log.
