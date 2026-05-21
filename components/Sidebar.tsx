import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { View, UserRole } from '../types';
import useNotifications from '../hooks/useNotifications';
import * as api from '../services/apiService';
import PolicyModal, { PrivacyPolicy, TermsOfService } from './PolicyModal';
import type { ApprovalRequest } from '../services/apiService';

const NavLink: React.FC<{
  view: View;
  currentView: View;
  setView: (view: View) => void;
  children: React.ReactNode;
  badge?: number;
}> = ({ view, currentView, setView, children, badge }) => {
  const isActive = view === currentView;
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        setView(view);
      }}
      className={`flex items-center justify-between px-3 py-2.5 my-0.5 text-sm font-medium rounded-lg transition-all duration-150 ${
        isActive
          ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
          : 'text-gray-400 hover:bg-gray-700/60 hover:text-gray-100'
      }`}
    >
      <div className="flex items-center flex-1">
        {children}
      </div>
      {badge !== undefined && badge > 0 && (
        <span className="ml-2 px-1.5 py-0.5 text-xs font-bold bg-red-500 text-white rounded-full min-w-[1.25rem] text-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </a>
  );
};

const Sidebar: React.FC = () => {
  const { currentView, setView, state } = useAppContext();
  const { currentUser, currentOrganization } = state;

  // Sidebar collapse state
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [manualToggle, setManualToggle] = useState<boolean>(false);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number>(0);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  // Check if user is admin (only role that can manage approvals in this system)
  const isManagerOrAdmin = currentUser?.role === UserRole.Admin;

  const navItems = [
    { view: View.Dashboard, label: 'Dashboard', icon: <HomeIcon /> },
    { view: View.Inventory, label: 'Inventory', icon: <InventoryIcon /> },
    { view: View.Categories, label: 'Categories', icon: <CategoriesIcon /> },
    { view: View.LowStock, label: 'Low Stock', icon: <AlertIcon /> },
    { view: View.PriorityItems, label: 'Priority Items', icon: <PriorityIcon /> },
    { view: View.StockTake, label: 'Stock Take', icon: <StockTakeIcon /> },
    // { view: View.PurchaseOrders, label: 'Purchase Orders', icon: <PurchaseOrderIcon /> }, // Coming soon
    { view: View.Reports, label: 'Reports', icon: <ReportsIcon /> },
    { view: View.Activity, label: 'Activity Log', icon: <ActivityIcon /> },
    { view: View.ZohoApprovals, label: 'Approvals', icon: <ApprovalIcon />, roles: [UserRole.Admin], badge: pendingApprovalsCount },
    { view: View.Integrations, label: 'Integrations', icon: <IntegrationsIcon />, roles: [UserRole.Admin] },
    // Billing temporarily hidden — re-enable later
    // { view: View.Billing, label: 'Billing', icon: <BillingIcon />, roles: [UserRole.Admin] },
    { view: View.Settings, label: 'Settings', icon: <SettingsIcon /> },
  ];
  
  const accessibleNavItems = navItems.filter(item => {
    if (!item.roles) return true;
    if (!currentUser) return false;
    // Support both UserRole enum and string role checks
    return item.roles.some((role: any) => 
      role === currentUser.role || 
      (typeof role === 'string' && currentUser.role === role)
    );
  });
  const { isSessionActive } = useNotifications();

  // Fetch pending approvals count for managers/admins
  useEffect(() => {
    if (!isManagerOrAdmin || !currentOrganization?.id) {
      setPendingApprovalsCount(0);
      return;
    }

    const fetchPendingCount = async () => {
      try {
        const approvals = await api.getApprovals(currentOrganization.id);
        const pending = approvals.filter((a: any) => a.status === 'pending').length;
        setPendingApprovalsCount(pending);
      } catch (error) {
        console.error('Error fetching pending approvals count:', error);
        setPendingApprovalsCount(0);
      }
    };

    fetchPendingCount();
    
    // Poll every 30 seconds for updates
    const interval = setInterval(fetchPendingCount, 30000);
    return () => clearInterval(interval);
  }, [isManagerOrAdmin, currentOrganization?.id]);

  useEffect(() => {
    if (!isManagerOrAdmin) return;

    const handleRealtimeApprovals = (event: Event) => {
      const approvals = (event as CustomEvent<ApprovalRequest[]>).detail;
      const pending = approvals.filter(approval => approval.status === 'pending').length;
      setPendingApprovalsCount(pending);
    };

    window.addEventListener('approvalsUpdate', handleRealtimeApprovals as EventListener);
    return () => window.removeEventListener('approvalsUpdate', handleRealtimeApprovals as EventListener);
  }, [isManagerOrAdmin]);

  // Initialize collapse state from localStorage and screen width
  useEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    const savedBool = saved === 'true';
    if (saved !== null) {
      setCollapsed(savedBool);
      setManualToggle(true);
    } else {
      // Auto-collapse on small screens
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setCollapsed(true);
      }
    }
  }, []);

  // Auto-collapse/expand on resize unless user manually toggled
  useEffect(() => {
    const onResize = () => {
      if (manualToggle) return; // user preference takes precedence
      if (window.innerWidth < 768 && !collapsed) setCollapsed(true);
      if (window.innerWidth >= 768 && collapsed) setCollapsed(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [collapsed, manualToggle]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    setManualToggle(true);
    localStorage.setItem('sidebarCollapsed', next ? 'true' : 'false');
  };


  return (
    <div className={`${collapsed ? 'w-16' : 'w-60'} bg-gray-900 text-white flex-shrink-0 flex flex-col h-screen overflow-hidden transition-all duration-300 border-r border-gray-800`}>
      {/* Logo / Brand */}
      <div className={`flex items-center justify-center h-16 border-b border-gray-800/60 flex-col px-3 ${collapsed ? 'py-3' : ''}`}>
         <div className="flex items-center gap-2">
            <img src="/image/stockflow logo.png" alt="StockFlow Logo" className="w-8 h-8 object-contain flex-shrink-0" />
            {!collapsed && <span className="text-lg font-bold tracking-tight text-white">Stock<span className="text-indigo-400">Flow</span></span>}
         </div>
         {currentOrganization && !collapsed && (
            <p className="text-xs text-gray-500 mt-1 truncate w-full text-center leading-tight">{currentOrganization.name}</p>
         )}
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
        {accessibleNavItems.map(({ view, label, icon, badge }) => (
          <NavLink key={view} view={view} currentView={currentView} setView={setView} badge={badge}>
            <div className={`relative flex-shrink-0 ${collapsed ? 'mx-auto' : ''}`}>
              {icon}
              {/* Live session indicator for Stock Take */}
              {isSessionActive && view === View.StockTake && (
                <span className={`${collapsed ? 'absolute -right-1 -top-1' : 'absolute -right-2 -top-2'} flex items-center justify-center pointer-events-none`}>
                  <span className="absolute inline-flex w-6 h-6 rounded-full bg-green-400 opacity-40 animate-ping"></span>
                  <span className="relative inline-flex w-3 h-3 bg-green-500 rounded-full ring-2 ring-gray-900"></span>
                </span>
              )}
            </div>
            {!collapsed && <span className="ml-3 truncate">{label}</span>}
            {collapsed && <span className="sr-only">{label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="flex-shrink-0 px-2 py-3 border-t border-gray-800/60 flex flex-col items-center gap-2">
        <button onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-gray-400 transform transition-transform ${collapsed ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        {!collapsed && (
          <>
            <div className="text-center text-xs text-gray-600">
                <button onClick={() => setShowPrivacy(true)} className="hover:text-gray-400 transition-colors">Privacy</button>
                <span className="mx-1 text-gray-700">&middot;</span>
                <button onClick={() => setShowTerms(true)} className="hover:text-gray-400 transition-colors">Terms</button>
            </div>
            <p className="text-xs text-gray-700">&copy; 2026 StockFlow</p>
          </>
        )}
      </div>

      <PolicyModal 
        isOpen={showPrivacy} 
        onClose={() => setShowPrivacy(false)} 
        title="Privacy Policy" 
        content={<PrivacyPolicy />} 
      />
      <PolicyModal 
        isOpen={showTerms} 
        onClose={() => setShowTerms(false)} 
        title="Terms of Service" 
        content={<TermsOfService />} 
      />
    </div>
  );
};

// SVG Icons for Sidebar
const HomeIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>;
const InventoryIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>;
const AlertIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>;
const ReportsIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M18 20V10"></path><path d="M12 20V4"></path><path d="M6 20V14"></path></svg>;
const ActivityIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>;
const SettingsIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
const StockTakeIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="m9 14 2 2 4-4"></path></svg>;
const PurchaseOrderIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>;
const IntegrationsIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 2l-3.5 3.5 3.5 3.5 3.5-3.5L12 2zM2 12l3.5 3.5L9 12l-3.5-3.5L2 12zm10 10l3.5-3.5-3.5-3.5-3.5 3.5 3.5 3.5zM22 12l-3.5-3.5L15 12l3.5 3.5 3.5-3.5z"/></svg>;
const BillingIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>;

const PriorityIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M12 2l4 4-4 4-4-4 4-4z" />
    <path d="M6 14l6 6 6-6" />
  </svg>
);

const ApprovalIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M9 11l3 3L22 4"></path>
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
  </svg>
);

const CategoriesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <rect x="3" y="3" width="7" height="7"/>
    <rect x="14" y="3" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/>
  </svg>
);


export default Sidebar;