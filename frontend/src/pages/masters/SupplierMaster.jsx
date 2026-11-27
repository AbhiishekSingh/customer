import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../context/AuthContext'
import { PageHead } from '../../components/ui'
import { CategoryBlock, countByMulti } from '../../components/MasterBlocks'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function SupplierMaster() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: fabrics } = useApi(() => api.get('/fabrics'), [])
  const supplierCounts = fabrics ? countByMulti(fabrics, (f) => [f.supplier, ...(f.lapf_domestic || []), ...(f.lapf_export || [])]) : null

  return (
    <div>
      <PageHead title="Supplier" sub="Used on the Item Master. Categories are never deleted, only deactivated." />
      <CategoryBlock
          title="Supplier"
          hint="Used for Existing Supplier, Additional LAPF Domestic and LAPF Export on the Item Master — used count counts an item once even if a supplier appears in more than one of those fields on it."
          type="supplier"
          canEdit={canEdit}
          usageCounts={supplierCounts}
        />
    </div>
  )
}
