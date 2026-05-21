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
import { auth } from './services/firebase';
import type { User as FirebaseUser } from 'firebase/auth';
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
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
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
    
    if (auth) {
      await auth.signOut();
    }
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
    // Guard against unconfigured Firebase
    if (!auth) {
        console.log('⚠️ Firebase auth not initialized');
        setIsLoading(false);
        return;
    }

    console.log('🔐 Setting up auth state listener (one-time setup)');
    
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      try {
        // Mounted guard to avoid state updates after unmount
        if (!mountedRef.current) {
          console.log('⚠️ Component unmounted, skipping auth state update');
          return;
        }
        
        console.log('🔐 Auth state changed. User:', user ? `${user.email} (${user.uid})` : 'null');
        setIsLoading(true);
        if (user) {
        // Reset onboarding flag when switching accounts or for new users
        const storedOnboardingUid = localStorage.getItem('onboardingUid');
        console.log('🔍 UID check:', { storedUid: storedOnboardingUid, currentUid: user.uid, isNewUser: storedOnboardingUid !== user.uid });
        if (storedOnboardingUid !== user.uid) {
          console.log('🔄 New user or different user detected, clearing onboarding state');
          localStorage.setItem('onboardingUid', user.uid);
          localStorage.removeItem('onboardingCompleted');
          localStorage.removeItem('currentView'); // Clear stored view to start fresh
          localStorage.removeItem('pendingView'); // Clear any pending view redirects
          setOnboardingCompleted(false);
        }

        // Prevent multiple simultaneous getUserData calls
        if (isLoadingUserDataRef.current) {
          console.log('⏭️ Skipping getUserData call - already in progress');
          setIsLoading(false);
          return;
        }
        
        setLoadingMessage('Loading your account...');
        setFirebaseUser(user);
        isLoadingUserDataRef.current = true;
        try {
          console.log('👤 Fetching user data for:', user.email);
          console.log('🔍 Pre-fetch onboarding state:', { onboardingCompleted });
          setLoadingMessage('Checking user profile...');
          const result = await api.getUserData(user.uid);
          
          if (result) {
            console.log('✅ User data loaded successfully:', result.user.name, 'from org:', result.organization.name);
            setLoadingMessage('Setting up dashboard...');

            // Persist onboarding flag from server to local state/storage
            const completed = result.user.onboardingCompleted === true;
            if (completed) {
              setOnboardingCompleted(true);
              localStorage.setItem('onboardingCompleted', 'true');
              localStorage.setItem('onboardingUid', user.uid);
            }
            
            // Store organization ID for FCM token storage
            localStorage.setItem('organizationId', result.organization.id);
            
            setAuthData({ user: result.user, organization: result.organization });
            
            console.log('✅ Organization setup complete:', result.organization.id);
            
            // Initialize FCM messaging for push notifications (silent - won't spam logs)
            initializeMessaging()
              .then(() => requestFCMPermission())
              .catch(() => {
                // FCM initialization is optional - app works without it
                console.log('ℹ️ Push notifications unavailable (requires HTTPS in production)');
              });
            
            // Notifications are now handled automatically by useNotifications hook
            console.log('🔔 Notification system initialized (Firestore-only)');
            
            // Check if user needs onboarding (empty inventory and no integrations) - but only if not manually completed
            // Don't show onboarding if they just connected to Zoho (integrations status changed)
            const hasZohoConnected = result.organization.integrations?.zoho?.status === 'connected';
            console.log('🔍 Onboarding check:', {
                onboardingCompletedState: onboardingCompleted,
                serverOnboardingCompleted: completed,
                inventoryCount: result.inventoryCount,
                hasZohoConnected,
                shouldShowOnboarding: !onboardingCompleted && !completed && result.inventoryCount === 0 && !hasZohoConnected
            });
            
            if (!onboardingCompleted && !completed && result.inventoryCount === 0 && !hasZohoConnected) {
                console.log('🎆 New organization detected, showing onboarding');
                setNeedsOnboarding(true);
            } else {
                console.log('🏢 Existing organization with data, integrations, or onboarding completed, skipping onboarding');
                setNeedsOnboarding(false);
            }
            
            // Start idle timer for authenticated users
            startIdleTimer();
          } else {
            console.log('⚠️ No user profile found on first attempt — checking if this is a new signup');

            // New users: Firestore write may not have propagated yet when onAuthStateChanged fires.
            // LoginPage sets 'signup_in_progress' before createUserWithEmailAndPassword so we know to retry.
            const signupTs = localStorage.getItem('signup_in_progress');
            const isNewUser = signupTs !== null && (Date.now() - parseInt(signupTs, 10)) < 60000;

            if (isNewUser) {
              console.log('🆕 New user detected — retrying getUserData up to 5 times with backoff');
              setLoadingMessage('Completing account setup...');
              let retryResult = null;
              for (let attempt = 1; attempt <= 5; attempt++) {
                await new Promise(r => setTimeout(r, attempt * 1000));
                console.log(`🔄 Retry attempt ${attempt}/5`);
                retryResult = await api.getUserData(user.uid);
                if (retryResult) break;
              }

              localStorage.removeItem('signup_in_progress');
              if (retryResult) {
                const completed = retryResult.user.onboardingCompleted === true;
                if (completed) {
                  setOnboardingCompleted(true);
                  localStorage.setItem('onboardingCompleted', 'true');
                  localStorage.setItem('onboardingUid', user.uid);
                }
                localStorage.setItem('organizationId', retryResult.organization.id);
                setAuthData({ user: retryResult.user, organization: retryResult.organization });
                startIdleTimer();
                const hasZohoConnected = retryResult.organization.integrations?.zoho?.status === 'connected';
                if (!onboardingCompleted && !completed && retryResult.inventoryCount === 0 && !hasZohoConnected) {
                  setNeedsOnboarding(true);
                } else {
                  setNeedsOnboarding(false);
                }
              } else {
                console.log('❌ Profile still not found after retries — signing out');
                addToast({ message: 'Account setup incomplete. Please try signing up again.', type: 'error' });
                if (auth) await auth.signOut();
              }
            } else {
              console.log('⚠️ Existing user with no profile — signing out');
              addToast({ message: 'Account setup incomplete. Please try signing up again.', type: 'error' });
              if (auth) await auth.signOut();
            }
          }
        } catch (error: any) {
          console.error('❌ Error fetching user data:', error);
          console.error('❌ Full error details:', {
            message: error.message,
            code: error.code,
            stack: error.stack
          });
          setLoadingMessage('Database connection error...');
          
          if (error.message.includes('Firestore') || error.message.includes('timeout')) {
            addToastRef.current({ 
              message: 'Database connection failed. Please check if Firestore is enabled in your Firebase project.', 
              type: 'error' 
            });
          } else {
            addToastRef.current({ message: 'Failed to fetch user data. Please try signing out and back in.', type: 'error' });
          }
          
          // Sign out user on data fetch errors (except database setup issues)
          if (!error.message.includes('Firestore') && !error.message.includes('timeout')) {
            if(auth) await auth.signOut();
          }
        } finally {
          isLoadingUserDataRef.current = false;
        }
      } else {
        // User signed out
        console.log('🚪 User signed out, clearing state');
        setLoadingMessage('Initializing...');
        setFirebaseUser(null);
        setAuthData(null);
        setNeedsOnboarding(false);
        // Keep onboardingCompleted persistent across signouts
        
        console.log('✅ Cleanup complete');
        
        // Stop idle timer when user signs out
        stopIdleTimer();
        
        // Clear any lingering warning states
        setShowIdleWarning(false);
        setWarningCountdown(30);
      }
      setIsLoading(false);
      } catch (error) {
        console.error('❌ Error in auth state change handler:', error);
        if (mountedRef.current) {
          setIsLoading(false);
          addToastRef.current({ 
            message: 'Authentication error occurred. Please refresh the page.', 
            type: 'error' 
          });
        }
      }
    });
    
    return () => {
      console.log('🔐 Cleaning up auth state listener');
      unsubscribe();
    };
  }, []); // Empty deps - subscribe only once on mount
  
  const handleOnboardingComplete = useCallback(async () => {
    setNeedsOnboarding(false);
    setOnboardingCompleted(true);
    localStorage.setItem('onboardingCompleted', 'true');
    if (firebaseUser) {
      localStorage.setItem('onboardingUid', firebaseUser.uid);
      if (authData) {
        await api.markOnboardingComplete(authData.organization.id, firebaseUser.uid);
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
      const result = await api.getUserData(authData.user.uid);
      if (result) {
        setAuthData({ user: result.user, organization: result.organization });
      }
      setNeedsOnboarding(false);
      setOnboardingCompleted(true);
      localStorage.setItem('onboardingCompleted', 'true');
      if (authData && firebaseUser) {
        await api.markOnboardingComplete(authData.organization.id, firebaseUser.uid);
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
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(API_ENDPOINTS.zohoAuthUrl(authData.organization.id, firebaseUser.uid), {
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
      api.markOnboardingComplete(authData.organization.id, firebaseUser.uid);
    }
    // Store the intended view in localStorage so MainLayout can pick it up
    localStorage.setItem('pendingView', 'integrations');
  }, []);

  const handleExcelImport = useCallback(() => {
    setNeedsOnboarding(false);
    setOnboardingCompleted(true);
    localStorage.setItem('onboardingCompleted', 'true');
    if (authData && firebaseUser) {
      api.markOnboardingComplete(authData.organization.id, firebaseUser.uid);
    }
    // Store the intended view in localStorage so MainLayout can pick it up
    localStorage.setItem('pendingView', 'integrations');
  }, []);

  const handlePosConnected = useCallback(() => {
    setNeedsOnboarding(false);
    setOnboardingCompleted(true);
    localStorage.setItem('onboardingCompleted', 'true');
    if (authData && firebaseUser) {
      api.markOnboardingComplete(authData.organization.id, firebaseUser.uid);
    }
    localStorage.setItem('pendingView', 'integrations');
  }, [authData, firebaseUser]);

  const handleLogout = useCallback(async () => {
    console.log('👋 Manual logout initiated');
    stopIdleTimer();
    setShowIdleWarning(false);
    
    if (auth) {
        await auth.signOut();
    }
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