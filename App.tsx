import React, { useState, useEffect, useCallback } from 'react';
import MainLayout from './components/MainLayout';
import LoginPage from './components/LoginPage';
import OnboardingPage from './pages/OnboardingPage';
import IdleWarningModal from './components/IdleWarningModal';
import ErrorBoundary from './components/ErrorBoundarySimple';
import { AppProvider } from './context/AppContext';
import { ToastProvider } from './components/ToastProvider';
import { User, Organization } from './types';
import * as api from './services/apiService';
import { API_ENDPOINTS } from './utils/apiConfig';
import { activityLogger } from './services/activityLogger';
import { useToast } from './hooks/useToast';
import { useIdleTimer } from './hooks/useIdleTimer';
import useNotifications from './hooks/useNotifications';
import { supabase, signOut as supabaseSignOut } from './services/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';
// Import user invite helper for console access
import './utils/userInviteHelper';
// Import FCM messaging
import { initializeMessaging, requestFCMPermission } from './firebaseMessaging';

interface AuthData {
  user: User;
  organization: Organization;
}

const Spinner: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
    {message && (
      <div className="text-center">
        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">{message}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">This may take a moment...</p>
      </div>
    )}
  </div>
);

const AppContent: React.FC = () => {
  const [authData, setAuthData] = useState<AuthData | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<SupabaseUser | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(() => {
    // Check localStorage for persistent onboarding state
    const saved = localStorage.getItem('onboardingCompleted');
    if (saved === 'true') {
      console.log('💡 Onboarding completed previously. To reset: localStorage.removeItem("onboardingCompleted")');
    }
    return saved === 'true';
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Initializing...');
  const isLoadingUserDataRef = React.useRef(false);
  const loadedUserIdRef = React.useRef<string | null>(null);
  const [isLoadingUserData, setIsLoadingUserData] = useState(false);
  
  // Auto logout configuration
  const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds
  const WARNING_DURATION = 30 * 1000; // 30 seconds in milliseconds
  
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const [warningCountdown, setWarningCountdown] = useState(30);
  const [isUserActive, setIsUserActive] = useState(true);
  const addToast = useToast();
  const addToastRef = React.useRef(addToast);
  const mountedRef = React.useRef(true);
  const idleTimerStartedRef = React.useRef(false);

  // Update ref when addToast changes
  React.useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  // Set mounted to true on mount, false on unmount
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Force logout function - defined early to avoid dependency issues
  const forceLogout = useCallback(async () => {
    console.log('🚪 Force logout initiated');
    setShowIdleWarning(false);
    
    // Clear any pending timeouts
    if ((window as any)._idleCountdownInterval) {
      clearInterval((window as any)._idleCountdownInterval);
    }
    if ((window as any)._idleAutoLogoutTimeout) {
      clearTimeout((window as any)._idleAutoLogoutTimeout);
    }
    
    addToast({ 
      message: 'You have been logged out due to inactivity for security purposes.', 
      type: 'info' 
    });
    
    await supabaseSignOut();
  }, [addToast]);

  // Handle idle timeout - show warning modal
  const handleIdle = useCallback(() => {
    if (firebaseUser && authData) {
      console.log('🕒 User idle detected, showing warning modal');
      setIsUserActive(false);
      setShowIdleWarning(true);
      setWarningCountdown(30);
      
      // Start 30-second countdown
      const countdownInterval = setInterval(() => {
        setWarningCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            forceLogout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      // Auto logout after 30 seconds
      const autoLogoutTimeout = setTimeout(() => {
        clearInterval(countdownInterval);
        forceLogout();
      }, WARNING_DURATION);
      
      // Store timeout references for cleanup
      (window as any)._idleCountdownInterval = countdownInterval;
      (window as any)._idleAutoLogoutTimeout = autoLogoutTimeout;
    }
  }, [firebaseUser, authData, forceLogout]);

  // Handle user becoming active again
  const handleActive = useCallback(() => {
    setIsUserActive(true);
    if (showIdleWarning) {
      console.log('👆 User activity detected, cancelling logout');
      setShowIdleWarning(false);
      setWarningCountdown(30);
      
      // Clear any pending timeouts
      if ((window as any)._idleCountdownInterval) {
        clearInterval((window as any)._idleCountdownInterval);
      }
      if ((window as any)._idleAutoLogoutTimeout) {
        clearTimeout((window as any)._idleAutoLogoutTimeout);
      }
    }
  }, [showIdleWarning]);

  // Initialize idle timer
  const { start: startIdleTimer, stop: stopIdleTimer, reset: resetIdleTimer } = useIdleTimer({
    timeout: IDLE_TIMEOUT,
    onIdle: handleIdle,
    onActive: handleActive,
    startOnMount: false, // We'll start it manually when user is authenticated
  });

  // Notifications
  const { notifications, unreadCount } = useNotifications();

  // Force logout handler with timer stop
  const handleForceLogout = useCallback(async () => {
    stopIdleTimer();
    await forceLogout();
  }, [stopIdleTimer, forceLogout]);

  // Stay logged in handler
  const handleStayLoggedIn = useCallback(() => {
    console.log('✅ User chose to stay logged in');
    setIsUserActive(true);
    setShowIdleWarning(false);
    setWarningCountdown(30);
    
    // Clear any pending timeouts
    if ((window as any)._idleCountdownInterval) {
      clearInterval((window as any)._idleCountdownInterval);
    }
    if ((window as any)._idleAutoLogoutTimeout) {
      clearTimeout((window as any)._idleAutoLogoutTimeout);
    }
    
    // Reset the idle timer
    resetIdleTimer();
    
    addToast({ 
      message: 'Session extended. Stay active to avoid automatic logout.', 
      type: 'info' 
    });
  }, [resetIdleTimer, addToast]);

  useEffect(() => {
    console.log('🔐 Initializing auth');

    // ── Shared profile loader ────────────────────────────────────────────
    // Called from BOTH the initial getSession() and the change listener.
    // The isLoadingUserDataRef guard ensures it never runs concurrently.
    const loadProfile = async (user: SupabaseUser) => {
      if (!mountedRef.current) return;
      if (isLoadingUserDataRef.current) {
        console.log('⏭️ loadProfile already in progress — skipping duplicate');
        return;
      }

      isLoadingUserDataRef.current = true;
      setFirebaseUser(user);
      // Only show fullscreen spinner on first load — background refreshes are silent
      if (!authData) {
        setIsLoading(true);
        setLoadingMessage('Checking user profile...');
      }

      // Clear onboarding flags when a DIFFERENT user logs in
      const storedUid = localStorage.getItem('onboardingUid');
      if (storedUid && storedUid !== user.id) {
        localStorage.setItem('onboardingUid', user.id);
        localStorage.removeItem('onboardingCompleted');
        localStorage.removeItem('currentView');
        localStorage.removeItem('pendingView');
        setOnboardingCompleted(false);
      }

      try {
        const result = await api.getUserData(user.id);

        if (!mountedRef.current) return;

        if (result) {
          console.log('✅ Profile loaded:', result.user.name, '/', result.organization.name);
          setLoadingMessage('Setting up dashboard...');

          const completed = localStorage.getItem('onboardingCompleted') === 'true';
          if (completed) {
            setOnboardingCompleted(true);
            localStorage.setItem('onboardingUid', user.id);
          }
          localStorage.setItem('organizationId', result.organization.id);
          setAuthData({ user: result.user, organization: result.organization });
          loadedUserIdRef.current = user.id;

          const hasZohoConnected = result.organization.integrations?.zoho?.status === 'connected';
          if (!completed && result.inventoryCount === 0 && !hasZohoConnected) {
            setNeedsOnboarding(true);
          } else {
            setNeedsOnboarding(false);
          }

          // FCM — optional, silent fail
          // (idle timer is started by the dedicated useEffect below — not here)
          initializeMessaging().then(() => requestFCMPermission()).catch(() => {});

        } else {
          // No profile row — new signup or DB lag
          const signupTs = localStorage.getItem('signup_in_progress');
          const isNewSignup = !!signupTs && (Date.now() - parseInt(signupTs, 10)) < 60_000;

          if (isNewSignup) {
            setLoadingMessage('Completing account setup...');
            let retryResult = null;
            for (let i = 1; i <= 5; i++) {
              await new Promise(r => setTimeout(r, i * 1000));
              if (!mountedRef.current) return;
              retryResult = await api.getUserData(user.id);
              if (retryResult) break;
            }
            localStorage.removeItem('signup_in_progress');

            if (retryResult && mountedRef.current) {
              const completed = localStorage.getItem('onboardingCompleted') === 'true';
              if (completed) {
                setOnboardingCompleted(true);
                localStorage.setItem('onboardingUid', user.id);
              }
              localStorage.setItem('organizationId', retryResult.organization.id);
              setAuthData({ user: retryResult.user, organization: retryResult.organization });
              loadedUserIdRef.current = user.id;
              const hasZoho = retryResult.organization.integrations?.zoho?.status === 'connected';
              setNeedsOnboarding(!completed && retryResult.inventoryCount === 0 && !hasZoho);
            } else {
              addToastRef.current({ message: 'Account setup incomplete. Please sign up again.', type: 'error' });
              await supabaseSignOut();
            }
          } else {
            // Existing user, transient DB error — keep session, show toast
            console.warn('⚠️ Profile not found for existing user — keeping session');
            addToastRef.current({ message: 'Could not load profile. Please refresh the page.', type: 'error' });
          }
        }
      } catch (err: any) {
        console.error('❌ Error loading profile:', err);
        addToastRef.current({ message: 'Failed to load profile — please refresh.', type: 'error' });
      } finally {
        isLoadingUserDataRef.current = false;
        if (mountedRef.current) setIsLoading(false);
      }
    };

    // ── Step 1: authoritative startup check ─────────────────────────────
    // getSession() is synchronous-ish and does NOT fire auth events.
    // This is the ONLY thing that drives the initial loading state.
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mountedRef.current) return;

      // Poisoned/expired refresh token → wipe local auth storage and show login.
      // scope:'local' clears only this tab's storage without round-tripping the server,
      // preventing recursive auth events that would restart the oscillation loop.
      if (error || (error as any)?.message?.includes('Refresh Token')) {
        console.warn('🔑 Stale refresh token — clearing local auth storage');
        supabase.auth.signOut({ scope: 'local' });
        loadedUserIdRef.current = null;
        setFirebaseUser(null);
        setAuthData(null);
        setIsLoading(false);
        return;
      }

      if (session?.user) {
        loadProfile(session.user);
      } else {
        // No session — show login immediately, no spinner
        setIsLoading(false);
      }
    });

    // ── Step 2: listen for GENUINE future auth changes only ──────────────
    // INITIAL_SESSION → skip (handled by getSession above)
    // TOKEN_REFRESHED → skip (background refresh, not a user action)
    // SIGNED_IN       → load profile (user just logged in via LoginPage)
    // SIGNED_OUT      → clear state, but ONLY if we're not in an active
    //                   initial load (transient SIGNED_OUT during token
    //                   refresh recovery must not destroy a loading session)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mountedRef.current) return;
      console.log('🔐 Auth event:', event);

      if (event === 'INITIAL_SESSION') return; // handled above

      if (event === 'TOKEN_REFRESHED') {
        setFirebaseUser(session?.user ?? null); // silent sync
        return;
      }

      if (event === 'SIGNED_IN' && session?.user) {
        // Skip if this exact user is already loaded — Supabase emits SIGNED_IN on
        // reconnects, multi-tab syncs, and session recoveries even when nothing changed.
        if (loadedUserIdRef.current === session.user.id && authData) {
          console.log('⏭️ SIGNED_IN skipped — user already loaded');
          return;
        }
        loadProfile(session.user);
        return;
      }

      if (event === 'SIGNED_OUT') {
        // Ignore transient SIGNED_OUT that fires during initial token recovery.
        // A real sign-out only happens AFTER the user was successfully loaded.
        if (isLoadingUserDataRef.current) {
          console.log('⏭️ Ignoring transient SIGNED_OUT during initial load');
          return;
        }
        console.log('🚪 User signed out');
        loadedUserIdRef.current = null;
        setFirebaseUser(null);
        setAuthData(null);
        setNeedsOnboarding(false);
        setLoadingMessage('Initializing...');
        stopIdleTimer();
        setShowIdleWarning(false);
        setWarningCountdown(30);
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  
  const handleOnboardingComplete = useCallback(async () => {
    setNeedsOnboarding(false);
    setOnboardingCompleted(true);
    localStorage.setItem('onboardingCompleted', 'true');
    if (firebaseUser) {
      localStorage.setItem('onboardingUid', firebaseUser.id);
      if (authData) {
        await api.markOnboardingComplete(authData.organization.id, firebaseUser.id);
      }
    }
    // Clear any saved view and navigate to Dashboard for new users
    localStorage.removeItem('currentView');
    addToast({ message: 'Setup complete! You can now add your first item.', type: 'info' });
  }, [addToast, firebaseUser, authData]);
  
  const handleImportFromZoho = useCallback(async () => {
    if (!authData) return;
    try {
      // Guard: integration must be connected before attempting import
      const status = authData.organization.integrations?.zoho?.status || 'disconnected';
      if (status !== 'connected') {
        addToast({ message: 'Connect Zoho in Integrations before importing.', type: 'info' });
        throw new Error('Zoho is not connected.');
      }

      const items = await api.getZohoItems(authData.organization.id);
      await api.importFromZoho(items, authData.organization.id);
      // Re-fetch data to reflect imported items
      const result = await api.getUserData(authData.user.id);
      if (result) {
        setAuthData({ user: result.user, organization: result.organization });
      }
      setNeedsOnboarding(false);
      setOnboardingCompleted(true);
      localStorage.setItem('onboardingCompleted', 'true');
      if (authData && firebaseUser) {
        await api.markOnboardingComplete(authData.organization.id, firebaseUser.id);
      }
      addToast({ message: 'Successfully imported items from Zoho!', type: 'success' });
    } catch (err: any) {
      const msg = err?.message || 'Failed to import from Zoho.';
      addToast({ message: msg, type: 'error' });
      // Re-throw so the onboarding button can stop its spinner in case of error
      throw err;
    }
  }, [authData, addToast]);

  const handleZohoConnectFromOnboarding = useCallback(async () => {
    if (!authData || !firebaseUser) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch(API_ENDPOINTS.zohoAuthUrl(authData.organization.id, firebaseUser.id), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || `HTTP ${response.status}`);
      addToast({ message: 'Redirecting to Zoho Books...', type: 'info' });
      setTimeout(() => { window.location.href = data.authUrl; }, 300);
    } catch (err: any) {
      addToast({ message: err.message || 'Failed to connect to Zoho', type: 'error' });
    }
  }, [authData, firebaseUser, addToast]);

  // Navigation handlers for onboarding - navigate to main app with specific view
  const handleGoogleSheetsImport = useCallback(() => {
    setNeedsOnboarding(false);
    setOnboardingCompleted(true);
    localStorage.setItem('onboardingCompleted', 'true');
    if (authData && firebaseUser) {
      api.markOnboardingComplete(authData.organization.id, firebaseUser.id);
    }
    // Store the intended view in localStorage so MainLayout can pick it up
    localStorage.setItem('pendingView', 'integrations');
  }, []);

  const handleExcelImport = useCallback(() => {
    setNeedsOnboarding(false);
    setOnboardingCompleted(true);
    localStorage.setItem('onboardingCompleted', 'true');
    if (authData && firebaseUser) {
      api.markOnboardingComplete(authData.organization.id, firebaseUser.id);
    }
    // Store the intended view in localStorage so MainLayout can pick it up
    localStorage.setItem('pendingView', 'integrations');
  }, []);

  const handlePosConnected = useCallback(() => {
    setNeedsOnboarding(false);
    setOnboardingCompleted(true);
    localStorage.setItem('onboardingCompleted', 'true');
    if (authData && firebaseUser) {
      api.markOnboardingComplete(authData.organization.id, firebaseUser.id);
    }
    localStorage.setItem('pendingView', 'integrations');
  }, [authData, firebaseUser]);

  const handleLogout = useCallback(async () => {
    console.log('👋 Manual logout initiated');
    stopIdleTimer();
    setShowIdleWarning(false);
    
    await supabaseSignOut();
  }, [stopIdleTimer]);

  // Start/stop idle timer based on authentication state  
  useEffect(() => {
    if (firebaseUser && authData && !needsOnboarding && !isLoading) {
      if (!idleTimerStartedRef.current) {
        console.log('▶️ Starting idle timer for authenticated user');
        startIdleTimer();
        idleTimerStartedRef.current = true;

        // Show security feature notification once
        const notificationTimeout = setTimeout(() => {
          addToast({
            message: `🔒 Security: Auto-logout after ${IDLE_TIMEOUT / 60000} minutes of inactivity is now active.`,
            type: 'info'
          });
        }, 2000);

        return () => {
          clearTimeout(notificationTimeout);
        };
      }
    } else {
      if (idleTimerStartedRef.current) {
        console.log('⏹️ Stopping idle timer (user not authenticated or loading)');
        stopIdleTimer();
        idleTimerStartedRef.current = false;
      }
      setShowIdleWarning(false);
      setIsUserActive(true);
    }
  }, [firebaseUser, authData, needsOnboarding, isLoading, startIdleTimer, stopIdleTimer, addToast]);

  // Cleanup idle timer on unmount
  useEffect(() => {
    return () => {
      stopIdleTimer();
      if ((window as any)._idleCountdownInterval) {
        clearInterval((window as any)._idleCountdownInterval);
      }
      if ((window as any)._idleAutoLogoutTimeout) {
        clearTimeout((window as any)._idleAutoLogoutTimeout);
      }
    };
  }, []);
  
  const renderContent = () => {
    if (isLoading) {
      return <Spinner message={loadingMessage} />;
    }
    
    if (!firebaseUser || !authData) {
      return <LoginPage />;
    }
    
    if (needsOnboarding) {
      return (
        <OnboardingPage
          organizationName={authData.organization.name}
          orgId={authData.organization.id}
          onImport={handleImportFromZoho}
          onZohoConnect={handleZohoConnectFromOnboarding}
          onStartFresh={handleOnboardingComplete}
          onGoogleSheetsImport={handleGoogleSheetsImport}
          onExcelImport={handleExcelImport}
          onPosConnected={handlePosConnected}
        />
      );
    }
    
    return (
      <AppProvider user={authData.user} organization={authData.organization}>
        <MainLayout onLogout={handleLogout} isUserActive={isUserActive} />
      </AppProvider>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100 font-sans">
      {renderContent()}
      
      {/* Idle Warning Modal */}
      <IdleWarningModal
        isOpen={showIdleWarning}
        countdown={warningCountdown}
        onStayLoggedIn={handleStayLoggedIn}
        onLogout={handleForceLogout}
        idleTimeoutMinutes={IDLE_TIMEOUT / 60000}
      />
    </div>
  );
}

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;