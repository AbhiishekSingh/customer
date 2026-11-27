import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../context/AuthContext'
import { PageHead } from '../../components/ui'
import { CategoryBlock, countBy } from '../../components/MasterBlocks'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function FabricCategoryMaster() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: fabrics } = useApi(() => api.get('/fabrics'), [])
  const fabricCategoryCounts = fabrics ? countBy(fabrics, (f) => f.fabric_category) : null

  return (
    <div>
      <PageHead title="Fabric Category" sub="Woven or Knit, used on the Item Master. Categories are never deleted, only deactivated." />
      <CategoryBlock title="Fabric Category" hint="Woven or Knit." type="fabric_category" canEdit={canEdit} usageCounts={fabricCategoryCounts} />
    </div>
  )
}
