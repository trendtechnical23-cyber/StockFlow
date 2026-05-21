import React, { useEffect } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import { useAppContext } from '../context/AppContext';
import { View } from '../types';

// Page components
import DashboardView from '../pages/DashboardView';
import InventoryView from '../pages/InventoryView';
import ReportsView from '../pages/ReportsView';
import ActivityView from '../pages/ActivityView';
import SettingsView from '../pages/SettingsView';
import StockTakeMonitorView from '../pages/StockTakeMonitorView';
import IntegrationsView from '../pages/IntegrationsView';
// Billing temporarily disabled — re-enable later
// import BillingView from '../pages/BillingView';
// import BillingSuccess from '../pages/BillingSuccess';
// import BillingCancel from '../pages/BillingCancel';
import ItemDetailView from '../pages/ItemDetailView';
import LowStockView from '../pages/LowStockView';
import PriorityItemsView from '../pages/PriorityItemsView';
import ZohoApprovalsView from '../pages/ZohoApprovalsView';
import CategoriesView from '../pages/CategoriesView';
// import PurchaseOrdersPage from '../pages/PurchaseOrdersPage'; // Coming soon

interface MainLayoutProps {
  onLogout: () => void;
  isUserActive?: boolean;
}

const MainLayout: React.FC<MainLayoutProps> = ({ onLogout, isUserActive = true }) => {
  const { currentView, setView } = useAppContext();

  // Check for pending navigation from onboarding or payment redirects
  useEffect(() => {
    // Check for Zoho callback path
    if (window.location.pathname.includes('/callback/zoho')) {
      setView(View.Integrations);
      // Don't clean up URL here - let IntegrationsView handle it
      return;
    }

    // Check localStorage
    const pendingView = localStorage.getItem('pendingView');
    if (pendingView) {
      localStorage.removeItem('pendingView');
      if (pendingView === 'integrations') {
        setView(View.Integrations);
      }
    }

    // Check URL parameters
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    if (viewParam) {
      // Billing temporarily disabled — re-enable later
      // if (viewParam === 'billing-success') setView(View.BillingSuccess);
      // if (viewParam === 'billing-cancel') setView(View.BillingCancel);

      // Clean up URL without reloading
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [setView]);

  const renderView = () => {
    switch (currentView) {
      case View.Dashboard:
        return <DashboardView />;
      case View.Inventory:
        return <InventoryView />;
      case View.ItemDetail:
        return <ItemDetailView />;
      case View.LowStock:
        return <LowStockView />;
      case View.PriorityItems:
        return <PriorityItemsView />;
      case View.StockTake:
        return <StockTakeMonitorView />;
      // case View.PurchaseOrders: return <PurchaseOrdersPage />; // Coming soon
      case View.Reports:
        return <ReportsView />;
      case View.Activity:
        return <ActivityView />;
      case View.Settings:
        return <SettingsView />;
      case View.Integrations:
        return <IntegrationsView />;
      // Billing temporarily disabled — re-enable later
      // case View.Billing:
      //   return <BillingView />;
      // case View.BillingSuccess:
      //   return <BillingSuccess />;
      // case View.BillingCancel:
      //   return <BillingCancel />;
      case View.ZohoApprovals:
        return <ZohoApprovalsView />;
      case View.Categories:
        return <CategoriesView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onLogout={onLogout} isUserActive={isUserActive} />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 dark:bg-gray-900 p-6">
          {renderView()}
        </main>
      </div>
    </div>
  );
};

export default MainLayout;