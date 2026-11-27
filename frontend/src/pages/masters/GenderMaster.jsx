import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../context/AuthContext'
import { PageHead } from '../../components/ui'
import { CategoryBlock, countByMulti } from '../../components/MasterBlocks'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function GenderMaster() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: fabrics } = useApi(() => api.get('/fabrics'), [])
  const genderCounts = fabrics ? countByMulti(fabrics, (f) => f.gender) : null

  return (
    <div>
      <PageHead title="Gender" sub="Used on the Item Master. Categories are never deleted, only deactivated." />
      {/* Gender is single-select on the Item Master form (Urvish, 2026-11-26) — "used by" below
          still counts an item once per gender value it currently has, which in practice is 0 or 1. */}
      <CategoryBlock title="Gender" hint="Men's or Women's — one gender per item." type="gender" canEdit={canEdit} usageCounts={genderCounts} />
    </div>
  )
}
