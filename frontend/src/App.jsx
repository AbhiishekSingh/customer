import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import Shell from './components/Shell'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import SetPassword from './pages/SetPassword'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'
import NewCustomer from './pages/NewCustomer'
import NewVisitEntry from './pages/NewVisitEntry'
import EntryList from './pages/EntryList'
import Presentation from './pages/Presentation'
import VisitContactDetail from './pages/VisitContactDetail'
import Visits from './pages/Visits'
import Outbox from './pages/Outbox'
import Register from './pages/Register'
import Blacklist from './pages/Blacklist'
import Reports from './pages/Reports'
import Activity from './pages/Activity'
import Fabrics from './pages/Fabrics'
import GenderMaster from './pages/masters/GenderMaster'
import SeasonMaster from './pages/masters/SeasonMaster'
import StoryMaster from './pages/masters/StoryMaster'
import SupplierMaster from './pages/masters/SupplierMaster'
import FabricCategoryMaster from './pages/masters/FabricCategoryMaster'
import FabricTypeMaster from './pages/masters/FabricTypeMaster'
import PrintTypeMaster from './pages/masters/PrintTypeMaster'
import CustomerCategoryMaster from './pages/masters/CustomerCategoryMaster'
import ColorMaster from './pages/masters/ColorMaster'
import CountriesStatesMaster from './pages/masters/CountriesStatesMaster'
import Users from './pages/Users'
import Settings from './pages/Settings'
import PortalPage from './pages/portal/PortalPage'

function Protected({ children }) {
  const { user, ready } = useAuth()
  if (!ready) return <div className="skeleton">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <Shell>{children}</Shell>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/set-password" element={<SetPassword />} />
      <Route path="/portal/:token" element={<PortalPage />} />

      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/customers" element={<Protected><Customers /></Protected>} />
      <Route path="/customers/new" element={<Protected><NewCustomer /></Protected>} />
      <Route path="/customers/:id" element={<Protected><CustomerDetail /></Protected>} />
      <Route path="/entry" element={<Protected><EntryList /></Protected>} />
      <Route path="/entry/new" element={<Protected><NewVisitEntry /></Protected>} />
      <Route path="/presentation/:id" element={<Protected><Presentation /></Protected>} />
      <Route path="/visits" element={<Protected><Visits /></Protected>} />
      <Route path="/visit/:visitId/:vcId" element={<Protected><VisitContactDetail /></Protected>} />
      <Route path="/outbox" element={<Protected><Outbox /></Protected>} />
      <Route path="/register" element={<Protected><Register /></Protected>} />
      <Route path="/blacklist" element={<Protected><Blacklist /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/activity" element={<Protected><Activity /></Protected>} />
      <Route path="/fabrics" element={<Protected><Fabrics /></Protected>} />
      {/* The old single bundled "/categories" page (Urvish's final-review point 1 — "Give all
          masters in a separate link") is replaced by one route per master below, each with its
          own sidebar link (see components/Shell.jsx). "/categories" itself now redirects to
          Gender rather than 404ing for anyone with the old link bookmarked. */}
      <Route path="/categories" element={<Navigate to="/masters/gender" replace />} />
      <Route path="/masters/gender" element={<Protected><GenderMaster /></Protected>} />
      <Route path="/masters/season" element={<Protected><SeasonMaster /></Protected>} />
      <Route path="/masters/story" element={<Protected><StoryMaster /></Protected>} />
      <Route path="/masters/supplier" element={<Protected><SupplierMaster /></Protected>} />
      <Route path="/masters/fabric-category" element={<Protected><FabricCategoryMaster /></Protected>} />
      <Route path="/masters/fabric-type" element={<Protected><FabricTypeMaster /></Protected>} />
      <Route path="/masters/print-type" element={<Protected><PrintTypeMaster /></Protected>} />
      <Route path="/masters/customer-category" element={<Protected><CustomerCategoryMaster /></Protected>} />
      <Route path="/masters/color" element={<Protected><ColorMaster /></Protected>} />
      <Route path="/masters/countries-states" element={<Protected><CountriesStatesMaster /></Protected>} />
      <Route path="/users" element={<Protected><Users /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
