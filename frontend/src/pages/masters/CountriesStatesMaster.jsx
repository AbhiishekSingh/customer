import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../context/AuthContext'
import { PageHead } from '../../components/ui'
import { CountriesStates, countBy } from '../../components/MasterBlocks'

const isMgr = (role) => role === 'manager' || role === 'admin' || role === 'top'

export default function CountriesStatesMaster() {
  const { user } = useAuth()
  const canEdit = isMgr(user?.role)
  const { data: customers } = useApi(() => api.get('/customers'), [])
  const countryCounts = customers ? countBy(customers, (c) => c.country) : null
  const stateCounts = customers
    ? countBy([...customers, ...customers.flatMap((c) => c.contacts || [])], (x) => x.state)
    : null

  return (
    <div>
      <PageHead title="Countries & States" sub="Used in registered and contact addresses. Categories are never deleted, only deactivated." />
      <CountriesStates canEdit={canEdit} countryCounts={countryCounts} stateCounts={stateCounts} />
    </div>
  )
}
