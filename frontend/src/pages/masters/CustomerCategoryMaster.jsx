import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../context/AuthContext'
import { PageHead } from '../../components/ui'
import { CategoryBlock, countBy } from '../../components/MasterBlocks'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function CustomerCategoryMaster() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: customers } = useApi(() => api.get('/customers'), [])
  // quality_category (legacy D&D swatch category) is intentionally not surfaced here — it's not
  // part of the Item Master rebuild, kept only in the data model/API for backward compatibility.
  const customerCatCounts = customers ? countBy(customers, (c) => c.category) : null

  return (
    <div>
      <PageHead title="Customer categories" sub="Used to group customers and filter customers and reports. Categories are never deleted, only deactivated." />
      <CategoryBlock title="Customer categories" hint="Used to group customers and filter customers and reports." type="customer" canEdit={canEdit} usageCounts={customerCatCounts} />
    </div>
  )
}
