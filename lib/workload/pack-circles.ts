export type CircleItem = {
  id: string
  value: number
}

export type PackedCircle = CircleItem & {
  x: number
  y: number
  r: number
}

export function circleRadius(
  value: number,
  valueScaleMax: number,
  minRadius: number,
  maxRadius: number
) {
  if (value <= 0 || valueScaleMax <= 0) return minRadius
  return minRadius + (maxRadius - minRadius) * Math.sqrt(value / valueScaleMax)
}

/**
 * Force-pack circles into a rectangle so area scales with `value`.
 * Pass `valueScaleMax` (e.g. the largest hours on any teammate) so the same hours
 * produce the same radius on every card.
 */
export function packCircles(
  items: CircleItem[],
  width: number,
  height: number,
  options?: {
    padding?: number
    minRadius?: number
    offsetX?: number
    offsetY?: number
    valueScaleMax?: number
    maxRadius?: number
  }
): PackedCircle[] {
  if (items.length === 0 || width <= 0 || height <= 0) return []

  const padding = options?.padding ?? 4
  const minR = options?.minRadius ?? 16
  const offsetX = options?.offsetX ?? 0
  const offsetY = options?.offsetY ?? 0
  const cx = offsetX + width * 0.52
  const cy = offsetY + height * 0.52
  const maxR = options?.maxRadius ?? Math.min(width, height) * 0.3
  const maxVal = options?.valueScaleMax ?? Math.max(...items.map((item) => item.value), 1)

  const nodes: PackedCircle[] = items.map((item, index) => {
    const r = circleRadius(item.value, maxVal, minR, maxR)
    const angle = (index / items.length) * Math.PI * 2 - Math.PI / 2
    return {
      ...item,
      r,
      x: cx + Math.cos(angle) * 12,
      y: cy + Math.sin(angle) * 12,
    }
  })

  // Only shrink to fit when this card is using its own max. A shared scale must
  // stay comparable across teammates, even if one card is sparser than another.
  if (options?.valueScaleMax == null) {
    const available = width * height * 0.52
    const area = nodes.reduce((sum, node) => sum + Math.PI * node.r * node.r, 0)
    if (area > available) {
      const scale = Math.sqrt(available / area)
      for (const node of nodes) {
        node.r = Math.max(12, node.r * scale)
      }
    }
  }

  const iterations = Math.min(220, 80 + nodes.length * 8)
  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy) || 0.01
        const minDist = a.r + b.r + padding
        if (dist < minDist) {
          const push = ((minDist - dist) / dist) * 0.5
          const ox = dx * push
          const oy = dy * push
          a.x -= ox
          a.y -= oy
          b.x += ox
          b.y += oy
        }
      }
    }

    for (const node of nodes) {
      node.x += (cx - node.x) * 0.07 * alpha
      node.y += (cy - node.y) * 0.07 * alpha
      node.x = Math.min(offsetX + width - node.r - 6, Math.max(offsetX + node.r + 6, node.x))
      node.y = Math.min(offsetY + height - node.r - 6, Math.max(offsetY + node.r + 6, node.y))
    }
  }

  return nodes
}
