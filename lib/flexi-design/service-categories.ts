import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Globe,
  Handshake,
  Layers,
  Mail,
  Megaphone,
  Palette,
  Presentation,
  Printer,
  SearchCheck,
  Share2,
  Smartphone,
  Ticket,
  Users,
  Video,
} from 'lucide-react'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Social: Share2,
  Email: Mail,
  Presentations: Presentation,
  'Web & landing pages': Globe,
  'Digital product micro-assets': Smartphone,
  'Paid & campaign': Megaphone,
  'Sales enablement': Handshake,
  'Brand assets': Palette,
  'Print & collateral': Printer,
  'Events & trade show': Ticket,
  'Employer branding & recruitment': Users,
  'Long-form content': BookOpen,
  'Data storytelling': BarChart3,
  'Video & motion': Video,
  'Audits & UX': SearchCheck,
}

export function getFlexiServiceCategoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? Layers
}
