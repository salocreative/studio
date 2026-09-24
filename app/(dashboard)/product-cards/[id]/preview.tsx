import { Badge } from '@/components/ui/badge'
import { CTA_LABELS, SECTION_LABELS, STATUS_LABELS, type ItemSection, type ProductCardStatus } from '@/lib/product-cards/model'

export interface PreviewItem {
  section: ItemSection
  title: string
  body: string
}

export interface PreviewExample {
  id: string
  title: string
  caption: string
  kindLabel: string
  isPublic: boolean
  imageUrl: string | null
}

const MAIN_SECTIONS: ItemSection[] = ['choose_when', 'approach', 'outcome']

function points(items: PreviewItem[], section: ItemSection) {
  return items.filter((item) => item.section === section && (item.title.trim() || item.body.trim()))
}

export function ProductCardPreview({
  name,
  category,
  status,
  decision,
  summary,
  priceLabel,
  priceNote,
  timeline,
  ctaKind,
  coverImageUrl,
  coverImageAlt,
  coverIsPublic,
  items,
  examples,
  relatedNames,
}: {
  name: string
  category: string
  status: ProductCardStatus
  decision: string
  summary: string
  priceLabel: string
  priceNote: string
  timeline: string
  ctaKind: keyof typeof CTA_LABELS
  coverImageUrl: string | null
  coverImageAlt: string
  coverIsPublic: boolean
  items: PreviewItem[]
  examples: PreviewExample[]
  relatedNames: string[]
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Preview</p>
        <Badge variant="outline">{STATUS_LABELS[status]}</Badge>
      </div>
      <div className="space-y-5 p-4">
        {coverImageUrl && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverImageUrl} alt={coverImageAlt} className="max-h-40 w-full rounded-md object-cover" />
            {!coverIsPublic && <Badge variant="outline">Not public</Badge>}
          </div>
        )}
        {status === 'retired' && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            No longer offered. Related products stay available below.
          </p>
        )}
        {category.trim() && (
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{category}</p>
        )}
        <div className="space-y-2">
          <h2 className="text-xl font-semibold leading-tight">{name.trim() || 'Untitled product'}</h2>
          <p className="text-sm leading-relaxed">
            {decision.trim() || 'What the client will be able to decide goes here.'}
          </p>
          {summary.trim() && <p className="text-sm text-muted-foreground">{summary}</p>}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{priceLabel}</p>
          {priceNote.trim() && <p className="text-xs text-muted-foreground">{priceNote}</p>}
          {timeline.trim() && <p className="text-xs text-muted-foreground">{timeline}</p>}
        </div>
        <div className="space-y-4">
          {MAIN_SECTIONS.map((section) => {
            const rows = points(items, section)
            if (rows.length === 0) return null
            return (
              <div key={section}>
                <h3 className="mb-1.5 text-sm font-medium">{SECTION_LABELS[section]}</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {rows.map((row, index) => (
                    <li key={`${section}-${index}`}>
                      {row.title.trim() && <span className="font-medium text-foreground">{row.title}. </span>}
                      {row.body}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
        {points(items, 'terms').length > 0 && (
          <div>
            <h3 className="mb-1.5 text-sm font-medium">{SECTION_LABELS.terms}</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {points(items, 'terms').map((row, index) => (
                <li key={`terms-${index}`}>{row.title.trim() || row.body}</li>
              ))}
            </ul>
          </div>
        )}
        {points(items, 'faq').length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{SECTION_LABELS.faq}</h3>
            {points(items, 'faq').map((row, index) => (
              <div key={`faq-${index}`}>
                <p className="text-sm font-medium">{row.title || 'Question'}</p>
                <p className="text-sm text-muted-foreground">{row.body}</p>
              </div>
            ))}
          </div>
        )}
        {examples.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Proof</h3>
            {examples.map((example) => (
              <div key={example.id} className="rounded-md border p-2">
                {example.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={example.imageUrl} alt="" className="mb-2 max-h-28 w-full rounded object-cover" />
                )}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{example.title || example.kindLabel}</p>
                    {example.caption && <p className="text-xs text-muted-foreground">{example.caption}</p>}
                  </div>
                  <Badge variant={example.isPublic ? 'secondary' : 'outline'}>
                    {example.isPublic ? 'Public' : 'Not public'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
        {relatedNames.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-sm font-medium">Related</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {relatedNames.map((related) => (
                <li key={related}>{related}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground">
          {CTA_LABELS[ctaKind]}
        </div>
      </div>
    </div>
  )
}
