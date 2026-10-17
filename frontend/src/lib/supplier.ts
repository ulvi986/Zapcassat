"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { errorMessage } from "@/components/app/states"
import { api, newIdempotencyKey } from "./api"
import { useAuth } from "./auth"
import type { InventoryEvent, Product } from "./types"

/** The supplier business the signed-in user is working in. */
export function useBusiness() {
  const { supplierBusiness } = useAuth()
  if (!supplierBusiness) throw new Error("useBusiness used outside a supplier workspace")
  return { business: supplierBusiness, base: `/businesses/${supplierBusiness.id}` }
}

/** Invalidate everything derived from inventory after a write. */
export function useInvalidateInventory() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ["products"] })
    qc.invalidateQueries({ queryKey: ["inventory-events"] })
    qc.invalidateQueries({ queryKey: ["analytics"] })
    qc.invalidateQueries({ queryKey: ["listings-mine"] })
  }
}

export function useUndoEvent() {
  const { base } = useBusiness()
  const invalidate = useInvalidateInventory()
  return useMutation({
    mutationFn: (eventId: string) => api.post<{ event: InventoryEvent; product: Product }>(`${base}/inventory/events/${eventId}/undo`),
    onSuccess: (r) => {
      invalidate()
      toast.success(`Geri qaytarıldı: ${r.product.name}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useProductMutations() {
  const { base } = useBusiness()
  const invalidate = useInvalidateInventory()
  const undo = useUndoEvent()

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch<Product>(`${base}/products/${id}`, data),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const adjust = useMutation({
    mutationFn: ({ id, ...body }: { id: string; delta?: string; set_quantity?: string; reason?: string; expected_version?: number }) =>
      api.post<{ event: InventoryEvent; product: Product }>(`${base}/inventory/${id}/adjust`, body, newIdempotencyKey()),
    onSuccess: (r) => {
      invalidate()
      toast.success(`${r.product.name}: ${r.event.quantity_before} → ${r.event.quantity_after}`, {
        action: { label: "Geri al", onClick: () => undo.mutate(r.event.id) },
      })
    },
    onError: (e) => {
      toast.error(errorMessage(e))
      invalidate()
    },
  })

  return { update, adjust, undo, invalidate }
}
