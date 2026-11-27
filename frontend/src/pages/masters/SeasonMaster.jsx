import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../context/AuthContext'
import { PageHead } from '../../components/ui'
import { SeasonBlock, countBy } from '../../components/MasterBlocks'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function SeasonMaster() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: fabrics } = useApi(() => api.get('/fabrics'), [])
  const seasonCounts = fabrics ? countBy(fabrics, (f) => f.season) : null

  return (
    <div>
      <PageHead title="Season" sub="Used on the Item Master, with optional From/To dates. Categories are never deleted, only deactivated." />
      <SeasonBlock canEdit={canEdit} usageCounts={seasonCounts} />
    </div>
  )
}
