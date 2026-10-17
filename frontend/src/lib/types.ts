export type Unit = "piece" | "m2" | "m" | "m3" | "kg" | "ton" | "l" | "pack" | "set"
export type StockStatus = "in_stock" | "low" | "out_of_stock"

export interface Business {
  id: string
  name: string
  slug: string
  kind: "supplier" | "buyer"
  city: string | null
  description: string | null
  verified: boolean
  phone: string | null
  email: string | null
  address: string | null
  tax_id?: string | null
  created_at: string
}

export interface Me {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  city: string | null
  locale: string
  specialty: string | null
  company_name: string | null
  primary_role: "supplier" | "buyer" | null
  roles: ("supplier" | "buyer")[]
  onboarded: boolean
  memberships: { role: string; business: Business }[]
}

export interface Category {
  id: string
  slug: string
  name_az: string
  name_en: string
  name_tr: string
  icon: string | null
}

export type ListingStatus = "draft" | "active" | "paused"

export interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  attributes: Record<string, string>
  category: { id: string; name_az: string; slug: string } | null
  unit: Unit
  quantity: string
  reserved: string
  purchase_price: string | null
  selling_price: string | null
  currency: string
  inventory_value: string
  low_stock_threshold: number
  stock_status: StockStatus
  is_archived: boolean
  images: { id: string; url: string }[]
  listing: { id: string; status: ListingStatus; price: string } | null
  inventory_version: number
  created_at: string
  updated_at: string
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface Listing {
  id: string
  title: string
  description: string | null
  price: string
  currency: string
  unit: Unit
  min_order_qty: string
  available_quantity: string | null
  in_stock: boolean
  status: ListingStatus
  city: string | null
  image_url: string | null
  images: string[]
  category: { id: string; name_az: string; slug: string } | null
  attributes: Record<string, string>
  supplier: { id: string; name: string; slug: string; city: string | null; verified: boolean }
  published_at: string | null
  similar?: Listing[]
  product_id?: string
  product_name?: string
  private_quantity?: string
}

export interface RankedResult {
  listing: Listing
  score: number
  match: "exact" | "partial"
  reasons: string[]
  stock_ok: boolean | null
  estimated_total: string | null
}

export interface Criteria {
  text: string
  product_types: string[]
  attributes: string[]
  keywords: string[]
  quantity: string | null
  unit: Unit | null
  city: string | null
  max_price: string | null
  prefer_cheap: boolean
}

export interface SmartSearchResult {
  criteria: Criteria
  results: RankedResult[]
  alternatives: Listing[]
}

export interface InventoryEvent {
  id: string
  product_id: string
  product_name: string | null
  unit: Unit | null
  event_type: string
  source: string
  delta: string
  quantity_before: string
  quantity_after: string
  reason: string | null
  reverted: boolean
  undoable: boolean
  created_at: string
}

export interface Quotation {
  id: string
  unit_price: string
  quantity: string
  total: string
  currency: string
  delivery_days: number | null
  valid_until: string | null
  notes: string | null
  status: "sent" | "accepted" | "rejected" | "withdrawn"
  created_at: string
}

export interface QuoteRequest {
  id: string
  group_id: string | null
  title: string
  quantity: string
  unit: Unit
  city: string | null
  notes: string | null
  status: "open" | "quoted" | "accepted" | "declined" | "cancelled"
  created_at: string
  listing: Listing | null
  quotations: Quotation[]
  buyer?: { name: string; email: string; phone: string | null; city: string | null; specialty: string | null; company_name: string | null }
  supplier?: { name: string; slug: string; city: string | null; verified: boolean }
}

export type OrderStatus = "pending" | "confirmed" | "fulfilled" | "cancelled"

export interface Order {
  id: string
  order_number: string
  status: OrderStatus
  subtotal: string
  total: string
  currency: string
  notes: string | null
  delivery_address: string | null
  created_at: string
  confirmed_at: string | null
  quotation_id: string | null
  items: { id: string; name: string; quantity: string; unit: Unit; unit_price: string; line_total: string; listing_id: string | null }[]
  buyer?: { name: string; email: string; phone: string | null; city: string | null; company_name: string | null }
  supplier?: { name: string; slug: string; city: string | null; phone: string | null }
}

export interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}

export interface LowStockItem {
  id: string
  name: string
  sku: string
  quantity: string
  unit: Unit
  threshold: number
  status: StockStatus
}

export interface AnalyticsOverview {
  period_days: number
  metrics: {
    total_products: number
    total_units: string
    inventory_value: string
    monthly_revenue: string
    previous_month_revenue: string
    active_orders: number
    pending_quotations: number
    low_stock_products: number
    out_of_stock_products: number
  }
  series: { date: string; revenue: string; units: string; orders: number }[]
  has_sales: boolean
  top_products: { name: string; revenue: string; units: string }[]
  categories: { category: string; value: string; products: number }[]
  low_stock: LowStockItem[]
  recent_orders: { id: string; order_number: string; status: OrderStatus; total: string; created_at: string }[]
  recent_inventory_events: {
    id: string; product_name: string; unit: Unit; event_type: string; delta: string; quantity_after: string; source: string; created_at: string
  }[]
}

// ---- AI
export interface PreviewField {
  key: string
  label: string
  value: string | null
}

export interface ActionPreview {
  title: string
  summary: string
  fields: PreviewField[]
  editable?: string[]
  warnings: string[]
  matches?: { id: string; name: string; sku: string; quantity: string; unit: Unit; score: number }[]
  missing?: string[]
  blocked?: boolean
}

export interface AIAction {
  id: string
  tool: string
  arguments: Record<string, unknown>
  preview: ActionPreview
  status: "pending" | "executed" | "rejected" | "failed"
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
  decided_at: string | null
}

export interface InventoryRow {
  id: string
  sku: string
  name: string
  quantity: string
  unit: Unit
  selling_price: string | null
  purchase_price: string | null
  stock_status: StockStatus
  inventory_value: string
  low_stock_threshold: number
  category: string | null
}

export interface SupplierSummary {
  id: string
  name: string
  slug: string
  city: string | null
  description: string | null
  verified: boolean
  phone: string | null
  address: string | null
  member_since: string | null
  active_listings: number
  listings?: Listing[]
}

export interface InventorySummary {
  total_products: number
  total_units: string
  inventory_value: string
  low_stock_count: number
  out_of_stock_count: number
  low_stock: LowStockItem[]
}

export interface SalesItem {
  name: string
  revenue?: string
  units?: string
  quantity?: string
  unit?: Unit
  inventory_value?: string
  orders?: number
}

export type ChatBlock =
  | { type: "action"; action: AIAction }
  | { type: "inventory_table"; title: string; total: number; items: InventoryRow[] }
  | { type: "inventory_summary"; data: InventorySummary }
  | { type: "analytics"; data: { metric: string; days: number; total_revenue?: string; items: SalesItem[] } }
  | ({ type: "listings" } & SmartSearchResult)
  | { type: "comparison"; quantity: string | null; offers: (Listing & { estimated_total: string | null })[]; cheapest_id: string | null }
  | { type: "suppliers"; city: string | null; items: SupplierSummary[] }
  | { type: "notice"; level: "info" | "warning"; text: string }

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  blocks: ChatBlock[]
  created_at: string
  pending?: boolean
  error?: string
}

export interface Conversation {
  id: string
  title: string
  mode: "supplier" | "buyer"
  business_id: string | null
  created_at: string
  updated_at: string
  messages?: ChatMessage[]
}

export interface AIStatus {
  mode: "llm" | "offline"
  provider: string
  model: string
  streaming: boolean
  note?: string
}
