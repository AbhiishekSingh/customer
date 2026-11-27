import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../context/AuthContext'
import { PageHead } from '../../components/ui'
import { CategoryBlock, countBy } from '../../components/MasterBlocks'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function PrintTypeMaster() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: fabrics } = useApi(() => api.get('/fabrics'), [])
  const printTypeCounts = fabrics ? countBy(fabrics, (f) => f.print_type) : null

  return (
    <div>
      <PageHead title="Print Type" sub="e.g. Dyed, RFD, Digital Print — used on the Item Master. Categories are never deleted, only deactivated." />
      <CategoryBlock title="Print Type" hint="e.g. Dyed, RFD, Digital Print — used on the Item Master." type="print_type" canEdit={canEdit} usageCounts={printTypeCounts} />
    </div>
  )
}
