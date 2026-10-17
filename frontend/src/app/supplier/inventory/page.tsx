"use client"

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import {
  type ColumnDef,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  type GroupingState,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table"
import {
  Archive, ArrowDown, ArrowUp, ArrowUpDown, Boxes, ChevronDown, ChevronRight, Download, FileUp, History, Megaphone,
  MoreHorizontal, Package, PackagePlus, Pencil, Search, Sparkles,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { StockBadge } from "@/components/app/badges"
import { selectClass } from "@/components/app/form-field"
import { EmptyState, ErrorState, errorMessage, LoadingRows, PageHeader } from "@/components/app/states"
import { EditableCell, nonNegative, requiredNonNegative } from "@/components/supplier/editable-cell"
import { AdjustStockDialog, EventsSheet, ImportDialog } from "@/components/supplier/inventory-dialogs"
import { ProductFormDialog } from "@/components/supplier/product-form"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { api, downloadFile, qs } from "@/lib/api"
import { formatDateTime, formatMoney, formatQty, UNIT_LABELS, UNITS } from "@/lib/format"
import { useCategories } from "@/lib/hooks"
import { useBusiness, useInvalidateInventory, useProductMutations } from "@/lib/supplier"
import type { Paged, Product } from "@/lib/types"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 50
const SORTABLE: Record<string, string> = { name: "name", sku: "sku", quantity: "quantity", selling_price: "selling_price", purchase_price: "purchase_price", updated_at: "updated_at" }

export default function InventoryPage() {
  const { base } = useBusiness()
  const cats = useCategories()
  const { update, adjust } = useProductMutations()
  const invalidate = useInvalidateInventory()

  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [stock, setStock] = useState("")
  const [category, setCategory] = useState("")
  const [page, setPage] = useState(1)
  const [sorting, setSorting] = useState<SortingState>([{ id: "updated_at", desc: true }])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [groupByCategory, setGroupByCategory] = useState(false)
  const [expanded, setExpanded] = useState<ExpandedState>(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [historyFor, setHistoryFor] = useState<Product | null | undefined>(undefined)
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const sortParam = sorting[0] ? `${sorting[0].desc ? "-" : ""}${SORTABLE[sorting[0].id] ?? "updated_at"}` : "-updated_at"
  const q = useQuery({
    queryKey: ["products", base, debounced, stock, category, page, sortParam],
    queryFn: () => api.get<Paged<Product>>(`${base}/products${qs({ q: debounced, stock, category_id: category, page, page_size: PAGE_SIZE, sort: sortParam })}`),
    placeholderData: keepPreviousData,
  })
  const items = useMemo(() => q.data?.items ?? [], [q.data])

  const archive = useMutation({
    mutationFn: (ids: string[]) => api.post<{ updated: number }>(`${base}/products/archive`, { ids, archived: true }),
    onSuccess: (r, ids) => {
      invalidate()
      setRowSelection({})
      toast.success(`${r.updated} məhsul arxivləndi`, {
        action: { label: "Geri al", onClick: () => api.post(`${base}/products/archive`, { ids, archived: false }).then(invalidate) },
      })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const columns = useMemo<ColumnDef<Product>[]>(() => [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox aria-label="Hamısını seç" checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)} />
      ),
      cell: ({ row }) => row.getIsGrouped() ? null : (
        <Checkbox aria-label={`${row.original.name} seç`} checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} />
      ),
      size: 36,
      enableSorting: false,
    },
    {
      id: "image",
      header: "",
      cell: ({ row }) => {
        const img = row.original.images[0]?.url
        return (
          <div className="flex size-9 items-center justify-center overflow-hidden rounded-lg border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img ? <img src={img} alt="" className="size-full object-cover" /> : <Package className="size-4 text-muted-foreground/60" />}
          </div>
        )
      },
      size: 48,
      enableSorting: false,
    },
    { accessorKey: "sku", header: "SKU", cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{row.original.sku}</span>, size: 100 },
    {
      accessorKey: "name",
      header: "Məhsul",
      cell: ({ row }) => (
        <EditableCell label="Məhsul adı" value={row.original.name} validate={(v) => (v.length >= 2 ? null : "Ən azı 2 simvol")}
          onSave={(v) => update.mutate({ id: row.original.id, data: { name: v } })} />
      ),
      size: 240,
    },
    {
      id: "category",
      accessorFn: (p) => p.category?.name_az ?? "Kateqoriyasız",
      header: "Kateqoriya",
      cell: ({ row }) => (
        <EditableCell label="Kateqoriya" type="select" value={row.original.category?.id ?? ""}
          display={<span className="text-muted-foreground">{row.original.category?.name_az ?? "—"}</span>}
          options={[{ value: "", label: "—" }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name_az }))]}
          onSave={(v) => update.mutate({ id: row.original.id, data: { category_id: v || null } })} />
      ),
      enableSorting: false,
      size: 150,
    },
    {
      accessorKey: "quantity",
      header: "Miqdar",
      cell: ({ row }) => (
        <EditableCell label="Miqdar" type="number" align="right" value={row.original.quantity} validate={requiredNonNegative}
          display={<span className="font-medium tabular">{formatQty(row.original.quantity)}</span>}
          onSave={(v) => adjust.mutate({ id: row.original.id, set_quantity: v, expected_version: row.original.inventory_version, reason: "Cədvəldə düzəliş" })} />
      ),
      size: 100,
    },
    {
      accessorKey: "unit",
      header: "Vahid",
      cell: ({ row }) => (
        <EditableCell label="Ölçü vahidi" type="select" value={row.original.unit} display={UNIT_LABELS[row.original.unit]}
          options={UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] }))}
          onSave={(v) => update.mutate({ id: row.original.id, data: { unit: v } })} />
      ),
      enableSorting: false,
      size: 80,
    },
    {
      accessorKey: "purchase_price",
      header: "Alış qiyməti",
      cell: ({ row }) => (
        <EditableCell label="Alış qiyməti" type="number" align="right" value={row.original.purchase_price ?? ""} validate={nonNegative}
          display={row.original.purchase_price ? <span className="tabular">{formatMoney(row.original.purchase_price)}</span> : undefined}
          onSave={(v) => update.mutate({ id: row.original.id, data: { purchase_price: v || null } })} />
      ),
      size: 120,
    },
    {
      accessorKey: "selling_price",
      header: "Satış qiyməti",
      cell: ({ row }) => (
        <EditableCell label="Satış qiyməti" type="number" align="right" value={row.original.selling_price ?? ""} validate={nonNegative}
          display={row.original.selling_price ? <span className="font-medium tabular">{formatMoney(row.original.selling_price)}</span> : undefined}
          onSave={(v) => update.mutate({ id: row.original.id, data: { selling_price: v || null } })} />
      ),
      size: 120,
    },
    { id: "currency", header: "Valyuta", cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.currency}</span>, enableSorting: false, size: 64 },
    {
      accessorKey: "inventory_value",
      header: "Inventar dəyəri",
      cell: ({ row }) => <span className="block whitespace-nowrap text-right tabular">{formatMoney(row.original.inventory_value)}</span>,
      enableSorting: false,
      size: 120,
    },
    { accessorKey: "stock_status", header: "Status", cell: ({ row }) => <StockBadge status={row.original.stock_status} />, enableSorting: false, size: 110 },
    { accessorKey: "updated_at", header: "Yenilənib", cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.original.updated_at)}</span>, size: 120 },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`${row.original.name} əməliyyatları`}><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setAdjusting(row.original)}><Boxes /> Stoku dəyiş</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setEditing(row.original); setFormOpen(true) }}><Pencil /> Redaktə et</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setHistoryFor(row.original)}><History /> Tarixçə</DropdownMenuItem>
            <DropdownMenuItem asChild><Link href={`/supplier/listings?product=${row.original.id}`}><Megaphone /> {row.original.listing ? "Elanı idarə et" : "Bazarda yerləşdir"}</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => archive.mutate([row.original.id])}><Archive /> Arxivlə</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      enableSorting: false,
      size: 48,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [cats.data])

  // must be referentially stable: a new array each render makes the table reset `expanded` forever
  const grouping = useMemo<GroupingState>(() => (groupByCategory ? ["category"] : []), [groupByCategory])
  const table = useReactTable({
    data: items,
    columns,
    state: { sorting, rowSelection, grouping, expanded },
    getRowId: (r) => r.id,
    onSortingChange: (u) => { setSorting(u); setPage(1) },
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    manualSorting: true,
    autoResetExpanded: false,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k])
  const total = q.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = !!(debounced || stock || category)

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <PageHeader
        title="Inventar"
        description="Xanaya klikləyərək birbaşa redaktə edin. Hər stok dəyişikliyi jurnala yazılır və geri qaytarıla bilər."
        actions={
          <>
            <Button variant="outline" onClick={() => setHistoryFor(null)}><History /> Tarixçə</Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}><FileUp /> İdxal</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline"><Download /> İxrac</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => downloadFile(`${base}/inventory/export?format=csv`, "inventar.csv").catch((e) => toast.error(errorMessage(e)))}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadFile(`${base}/inventory/export?format=xlsx`, "inventar.xlsx").catch((e) => toast.error(errorMessage(e)))}>Excel (.xlsx)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => { setEditing(null); setFormOpen(true) }}><PackagePlus /> Məhsul əlavə et</Button>
          </>
        }
      />

      <div className="flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-soft lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ad, SKU və ya xüsusiyyət (məs. “ağ qapı”)" className="pl-8" aria-label="Inventarda axtar" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Stok statusu" className={cn(selectClass, "w-auto")} value={stock} onChange={(e) => { setStock(e.target.value); setPage(1) }}>
            <option value="">Bütün stok statusları</option>
            <option value="attention">Diqqət tələb edənlər</option>
            <option value="low">Az qalıb</option>
            <option value="out">Bitib</option>
            <option value="in">Stokda var</option>
          </select>
          <select aria-label="Kateqoriya" className={cn(selectClass, "w-auto")} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }}>
            <option value="">Bütün kateqoriyalar</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name_az}</option>)}
          </select>
          <label className="flex items-center gap-2 px-1 text-sm">
            <Switch checked={groupByCategory} onCheckedChange={setGroupByCategory} /> Qruplaşdır
          </label>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-navy/20 bg-navy px-4 py-2 text-sm text-white">
          <span>{selectedIds.length} məhsul seçilib</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setRowSelection({})}>Seçimi ləğv et</Button>
            <Button size="sm" className="bg-lime text-navy hover:bg-lime-strong" disabled={archive.isPending}
              onClick={() => archive.mutate(selectedIds)}>
              <Archive /> Arxivlə
            </Button>
          </div>
        </div>
      )}

      {q.isPending ? (
        <LoadingRows rows={8} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyState icon={Search} title="Uyğun məhsul tapılmadı" description="Axtarış sözünü və ya filtrləri dəyişin." />
        ) : (
          <EmptyState icon={Boxes} title="İnventar boşdur" description="Məhsulu əl ilə, CSV faylı ilə və ya AI köməkçiyə adi dillə yazaraq əlavə edin."
            action={<div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => { setEditing(null); setFormOpen(true) }}><PackagePlus /> Məhsul əlavə et</Button>
              <Button asChild variant="outline"><Link href="/supplier/assistant"><Sparkles /> AI köməkçi</Link></Button>
            </div>} />
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
          <div className="overflow-x-auto">
            <table className={cn("w-full min-w-[1180px] border-collapse text-sm", q.isPlaceholderData && "opacity-60")}>
              <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="border-b">
                    {hg.headers.map((h) => {
                      const sortable = h.column.getCanSort() && SORTABLE[h.column.id]
                      const dir = h.column.getIsSorted()
                      return (
                        <th key={h.id} style={{ width: h.getSize() }} scope="col"
                          aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : undefined}
                          className={cn("h-10 px-3 text-left text-xs font-medium text-muted-foreground",
                            ["quantity", "purchase_price", "selling_price", "inventory_value"].includes(h.column.id) && "text-right")}>
                          {sortable ? (
                            <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                            </button>
                          ) : flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => {
                  if (row.getIsGrouped()) {
                    return (
                      <tr key={row.id} className="border-b bg-secondary/60">
                        <td colSpan={columns.length} className="px-3 py-2">
                          <button type="button" onClick={row.getToggleExpandedHandler()} className="flex items-center gap-2 text-sm font-medium" aria-expanded={row.getIsExpanded()}>
                            {row.getIsExpanded() ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            {String(row.groupingValue)} <span className="text-xs font-normal text-muted-foreground">({row.subRows.length})</span>
                          </button>
                        </td>
                      </tr>
                    )
                  }
                  const st = row.original.stock_status
                  return (
                    <tr key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}
                      className={cn("border-b transition-colors last:border-0 hover:bg-muted/40 data-[state=selected]:bg-brand-blue/5",
                        st === "low" && "bg-warning/[0.06]", st === "out_of_stock" && "bg-destructive/[0.05]")}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-3 py-1.5 align-middle">{cell.getIsPlaceholder() ? null : flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-2.5 text-sm text-muted-foreground sm:flex-row">
            <span>Cəmi {total} məhsul</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Əvvəlki</Button>
              <span className="tabular">{page} / {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Növbəti</Button>
            </div>
          </div>
        </div>
      )}

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editing ? items.find((p) => p.id === editing.id) ?? editing : null} />
      <AdjustStockDialog product={adjusting} onOpenChange={(o) => !o && setAdjusting(null)} />
      <EventsSheet open={historyFor !== undefined} onOpenChange={(o) => !o && setHistoryFor(undefined)} product={historyFor} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}
