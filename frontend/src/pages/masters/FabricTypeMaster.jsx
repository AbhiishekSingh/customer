import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../context/AuthContext'
import { PageHead } from '../../components/ui'
import { CategoryBlock, countBy } from '../../components/MasterBlocks'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function FabricTypeMaster() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: fabrics } = useApi(() => api.get('/fabrics'), [])
  const fabricTypeCounts = fabrics ? countBy(fabrics, (f) => f.fabric_type) : null

  return (
    <div>
      <PageHead title="Fabric Type" sub="e.g. Twill, Jacquard, Dobby — used on the Item Master. Categories are never deleted, only deactivated." />
      <CategoryBlock title="Fabric Type" hint="e.g. Twill, Jacquard, Dobby — used on the Item Master." type="fabric_type" canEdit={canEdit} usageCounts={fabricTypeCounts} />
    </div>
  )
}
