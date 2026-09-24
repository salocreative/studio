'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createProductCard, listProductCards, type ProductCardListItem } from '@/app/actions/product-cards'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PRICING_LABELS, STATUS_LABELS, productCardAssetUrl, type ProductCardStatus } from '@/lib/product-cards/model'
import { cn } from '@/lib/utils'

const FILTERS: { value: 'all' | ProductCardStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'published', label: 'Published' },
  { value: 'retired', label: 'Retired' },
]

const STATUS_CLASS: Record<ProductCardStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  unlisted: 'border-transparent bg-amber-100 text-amber-950',
  published: 'border-transparent bg-emerald-100 text-emerald-950',
  retired: 'bg-muted text-muted-foreground',
}

function formatUpdated(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ProductCardsClient() {
  const router = useRouter()
  const [cards, setCards] = useState<ProductCardListItem[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const result = await listProductCards()
      if ('error' in result && result.error) {
        setPageError(result.error)
        toast.error('Could not load product cards', { description: result.error })
        return
      }
      if (!('cards' in result)) return
      setPageError(null)
      setCards(result.cards)
      setCanManage(result.canManage)
    } catch (error) {
      console.error('Error loading product cards:', error)
      toast.error('Could not load product cards')
    } finally {
      setLoading(false)
    }
  }

  const visible = useMemo(
    () => (filter === 'all' ? cards : cards.filter((card) => card.status === filter)),
    [cards, filter]
  )

  async function createCard() {
    setCreating(true)
    try {
      const result = await createProductCard(name)
      if ('error' in result && result.error) {
        toast.error('Could not add the card', { description: result.error })
        return
      }
      if (!('id' in result)) return
      setDialogOpen(false)
      setName('')
      router.push(`/product-cards/${result.id}`)
    } catch (error) {
      console.error('Error creating product card:', error)
      toast.error('Could not add the card')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center justify-between gap-4 px-6">
          <div>
            <h1 className="text-2xl font-semibold">Product cards</h1>
            <p className="text-sm text-muted-foreground">
              What we sell as a repeatable product, published to products.salo.uk
            </p>
          </div>
          {canManage && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New card
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={filter === item.value ? 'default' : 'outline'}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading cards
          </div>
        ) : pageError ? (
          <Card>
            <CardContent className="py-8 text-sm">{pageError}</CardContent>
          </Card>
        ) : cards.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 py-8">
              <p className="font-medium">No product cards yet</p>
              <p className="max-w-xl text-sm text-muted-foreground">
                Each card leads with the decision a client can make afterwards, then how the work is done,
                then what they receive. The products site reads published cards from here.
              </p>
              {canManage && (
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  New card
                </Button>
              )}
            </CardContent>
          </Card>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cards with this status.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pricing</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Views, 30 days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((card) => (
                  <TableRow key={card.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {card.cover_image_path && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={productCardAssetUrl(card.cover_image_path) || ''}
                            alt={card.cover_image_alt || ''}
                            className="h-10 w-10 shrink-0 rounded-md border object-cover"
                          />
                        )}
                        <div>
                          <Link href={`/product-cards/${card.id}`} className="font-medium hover:underline">
                            {card.name}
                          </Link>
                          {card.category && (
                            <p className="text-xs text-muted-foreground">{card.category}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(STATUS_CLASS[card.status])}>
                        {STATUS_LABELS[card.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p>{card.price_label}</p>
                      <p className="text-xs text-muted-foreground">{PRICING_LABELS[card.pricing_model]}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatUpdated(card.updated_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{card.views_30d}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New product card</DialogTitle>
            <DialogDescription>
              Starts as a draft. The name becomes the public URL, which you can change before publishing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="product-card-name">Name</Label>
            <Input
              id="product-card-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="UX Audit"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void createCard()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={() => void createCard()} disabled={creating || !name.trim()}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
