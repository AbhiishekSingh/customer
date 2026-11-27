import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../context/AuthContext'
import { PageHead } from '../../components/ui'
import { CategoryBlock, countBy } from '../../components/MasterBlocks'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function ColorMaster() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: visits } = useApi(() => api.get('/visits'), [])
  // Colour variants were removed from the Item Master form, so this counts actual logged
  // VisitItem.color values (what the "Colors" master is really used for now), not
  // fabric.colour_variants (a field new items never populate).
  const colorCounts = visits
    ? countBy(
        visits.flatMap((v) => v.visit_contacts.flatMap((vc) => vc.items.map((i) => i.color))),
        (name) => name
      )
    : null

  return (
    <div>
      <PageHead title="Colors" sub="Used when logging which colour was given on a visit. Categories are never deleted, only deactivated." />
      <CategoryBlock title="Colors" hint="Used when logging which colour was given on a visit." type="color" canEdit={canEdit} usageCounts={colorCounts} />
    </div>
  )
}
