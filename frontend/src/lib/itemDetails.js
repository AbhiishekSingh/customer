// Shared definition of the "Item Master snapshot" fields captured on a visit line at
// Customer Visit Entry time (see components/ItemDetailsModal.jsx). Every field here mirrors a
// real column on the client's Item Master Excel sheet (see backend scripts/import_item_master_excel.py)
// — this is the single place that list is defined so the entry form, the review step, and the
// historical "Items given" view all agree on exactly what a snapshot contains.
export const ITEM_DETAIL_FIELDS = [
  'development_no', 'gender', 'season', 'story', 'fabric_category', 'fabric_type', 'print_type',
  'supplier', 'lapf_domestic', 'lapf_export', 'gsm', 'composition', 'warp', 'weft', 'fin_const',
  'width_cm', 'width_inch', 'price_meter', 'moq', 'remark', 'sort_no_sticker', 'dia_inch',
  'structure_gauge', 'fibre', 'yarn_details',
]

const MULTI_FIELDS = new Set(['gender', 'lapf_domestic', 'lapf_export'])

/** Build a fresh snapshot object from a Fabric (Item Master) record — this is what gets copied
 * onto a visit line the moment its Sort No. is chosen. Editing this snapshot afterwards never
 * writes back to the Fabric itself (see ItemDetailsModal). */
export function snapshotFromFabric(fabric) {
  const out = {}
  for (const field of ITEM_DETAIL_FIELDS) {
    const v = fabric?.[field]
    out[field] = MULTI_FIELDS.has(field) ? v || [] : v ?? ''
  }
  return out
}
