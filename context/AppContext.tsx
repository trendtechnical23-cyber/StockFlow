import React, { createContext, useReducer, useContext, useEffect, useCallback, ReactNode } from 'react';
import { AppState, Action, InventoryItem, User, Settings, View, Organization, ActivityLogEntry } from '../types';
import { useToast } from '../hooks/useToast';
import * as api from '../services/apiService';
import { activityLogger } from '../services/activityLogger';
import { updateItemWithBackend, getBackendHealth } from '../services/enhancedAPI';
import { sortByUsage } from '../utils/inventoryUtils';
import { firestore } from '../services/firebase';
import { doc, updateDoc, serverTimestamp, collection, query, orderBy, limit, onSnapshot, where } from 'firebase/firestore';
import type { Unsubscribe } from 'firebase/firestore';
import type { ApprovalRequest } from '../services/apiService';

// Get actual username from userId by looking up in users
const getUserDisplayName = (userId: string | undefined, users: User[]): string => {
    if (!userId) return 'Unknown User';
    
    // Look up the user in the users array to get their actual name
    const user = users.find(u => u.uid === userId);
    if (user) {
        return user.name || user.email?.split('@')[0] || 'Unknown User';
    }
    
    // If not found in users, extract from email if possible
    if (userId.includes('@')) {
        return userId.split('@')[0];
    }
    
    // Fallback to shortened userId
    return userId.length > 10 ? userId.substring(0, 8) : userId;
};

const appReducer = (state: AppState, action: Action): AppState => {
    switch (action.type) {
        case 'SET_INITIAL_DATA':
            return {
                ...state,
                ...action.payload,
                // ensure inventory is ordered by usage when initially loaded
                inventory: sortByUsage(action.payload.inventory || []),
                categories: action.payload.organization.categories || [],
                loading: { ...state.loading, inventory: false, users: false },
            };
        case 'SET_LOADING':
            return { ...state, loading: { ...state.loading, [action.payload.key]: action.payload.value } };
        case 'SET_ERROR':
            return { ...state, error: action.payload };
        case 'ADD_ITEM':
            // add then re-sort so new item lands in the right usage spot
            return { ...state, inventory: sortByUsage([action.payload, ...state.inventory]) };
        case 'UPDATE_ITEM':
            // update then re-sort to keep usage order
            return {
                ...state,
                inventory: sortByUsage(state.inventory.map(item => item.id === action.payload.id ? action.payload : item)),
            };
        case 'DELETE_ITEM':
            return { ...state, inventory: state.inventory.filter(item => item.id !== action.payload) };
        case 'ADD_USER':
            return { ...state, users: [...state.users, action.payload] };
        case 'UPDATE_USER':
             const updatedUsers = state.users.map(user => user.uid === action.payload.uid ? action.payload : user);
             const isCurrentUserUpdated = state.currentUser.uid === action.payload.uid;
             return {
                ...state,
                users: updatedUsers,
                currentUser: isCurrentUserUpdated ? action.payload : state.currentUser,
            };
        case 'DELETE_USER':
            return { ...state, users: state.users.filter(user => user.uid !== action.payload) };
        case 'UPDATE_SETTINGS': {
            const newSettings = { ...state.settings, ...action.payload };
            
            // Apply theme change immediately
            if (action.payload.theme) {
                const root = document.documentElement;
                root.classList.remove('light', 'dark');
                root.classList.add(action.payload.theme);

                // Update body background for better theme switching
                document.body.className = action.payload.theme === 'dark'
                    ? 'bg-gray-900 text-gray-100'
                    : 'bg-gray-100 text-gray-900';

                // Persist to a dedicated key that clearLocalData() never wipes,
                // so the choice survives org switches and tab reopens.
                try { localStorage.setItem('stockflow_theme', action.payload.theme); } catch (_) {}
            }
            
            try {
                // Use user-specific key so multiple users on same browser don't clash
                localStorage.setItem(`appSettings_${state.currentOrganization.id}_${state.currentUser.uid}`, JSON.stringify(newSettings));
                // Still keep org-level for backward compatibility or shared defaults if needed
                localStorage.setItem(`appSettings_${state.currentOrganization.id}`, JSON.stringify(newSettings));
            } catch (error) {
                console.error("Could not save settings to localStorage", error);
            }

            // PERSISTENCE: If theme changed, we want to save it to user profile in Firestore
            if (action.payload.theme) {
                import('../services/apiService').then(({ updateUserInOrganization }) => {
                    updateUserInOrganization({
                        ...state.currentUser,
                        themePreference: action.payload.theme // Add this field
                    }).catch(err => console.error("Failed to save theme to profile:", err));
                });
            }

            return { ...state, settings: newSettings };
        }
         case 'UPDATE_ORGANIZATION':
            return {
                ...state,
                currentOrganization: { ...state.currentOrganization, ...action.payload },
            };
        case 'UPDATE_INTEGRATION':
            return {
                ...state,
                currentOrganization: {
                    ...state.currentOrganization,
                    integrations: {
                        ...state.currentOrganization.integrations,
                        ...action.payload
                    }
                }
            };
        case 'UPDATE_SUBSCRIPTION':
            return {
                ...state,
                currentOrganization: {
                    ...state.currentOrganization,
                    subscription: {
                        ...state.currentOrganization.subscription,
                        ...action.payload
                    }
                }
            };
        case 'ADD_LOG':
            // Create clean log entry for dashboard actions (memory only - persistence handled elsewhere)
            console.log('📋 ADD_LOG action dispatched:', action.payload.action);
            
            // Check if required context is available
            if (!state.currentOrganization || !state.currentUser) {
                console.warn('⚠️ Missing context for activity log:', {
                    hasOrg: !!state.currentOrganization,
                    hasUser: !!state.currentUser
                });
                return state;
            }
            
            const timestamp = new Date().toISOString();
            const newLog: ActivityLogEntry = {
                id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                organizationId: state.currentOrganization.id,
                user: action.payload.user || state.currentUser.name || state.currentUser.email,
                action: action.payload.action,
                timestamp: timestamp,
                details: action.payload.details || 'No additional details'
            };
            
            console.log('📋 Created new log entry:', newLog.action);
            
            // Persist dashboard log to database
            try {
                import('../services/apiService').then(({ addLogAPI }) => {
                    addLogAPI({
                        user: newLog.user,
                        action: newLog.action,
                        details: newLog.details
                    }, state.currentOrganization.id).catch(err => {
                        console.error('❌ Failed to persist dashboard log:', err);
                    });
                });
            } catch (error) {
                console.error('❌ Failed to import services:', error);
            }
            
            // Don't add to local state - realtime listener will handle it
            // This prevents duplicate logs when the persisted log triggers the listener
            console.log('📋 Activity log persisted, waiting for realtime listener to update UI');
            
            return state;
        case 'SET_ACTIVITY_LOGS':
            return { ...state, activityLogs: action.payload };
        case 'SET_INVENTORY':
            return { ...state, inventory: action.payload };
        case 'SET_USERS':
            return { ...state, users: action.payload };
        case 'ADD_REALTIME_LOG':
            console.log('🔍 ADD_REALTIME_LOG - Current logs count:', state.activityLogs.length);
            const newLogs = [action.payload, ...state.activityLogs].slice(0, 100);
            console.log('🔍 ADD_REALTIME_LOG - After adding:', newLogs.length);
            return { ...state, activityLogs: newLogs };
        case 'ARCHIVE_ALL_LOGS':
            console.log('📁 Archiving all activity logs...');
            const archivedTimestamp = new Date().toISOString();
            const activeLogsToArchive = state.activityLogs.filter(log => !log.archived);
            
            // Update in Firestore asynchronously
            if (activeLogsToArchive.length > 0) {
                import('../services/apiService').then(({ updateActivityLogsAPI }) => {
                    const updates = activeLogsToArchive.map(log => ({
                        id: log.id,
                        archived: true,
                        archivedAt: archivedTimestamp
                    }));
                    updateActivityLogsAPI(state.currentOrganization.id, updates);
                });
            }
            
            const archivedLogs = state.activityLogs.map(log => 
                log.archived ? log : {
                    ...log,
                    archived: true,
                    archivedAt: archivedTimestamp
                }
            );
            console.log(`📁 Archived ${activeLogsToArchive.length} logs`);
            return { ...state, activityLogs: archivedLogs };
        case 'ARCHIVE_OLD_LOGS':
            console.log('🕐 Auto-archiving logs older than 1 hour...');
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const autoArchivedTimestamp = new Date().toISOString();
            
            const logsToAutoArchive = state.activityLogs.filter(log => {
                if (log.archived) return false; // Skip already archived logs
                const logDate = new Date(log.timestamp);
                return logDate < oneHourAgo;
            });
            
            // Update in Firestore asynchronously
            if (logsToAutoArchive.length > 0) {
                import('../services/apiService').then(({ updateActivityLogsAPI }) => {
                    const updates = logsToAutoArchive.map(log => ({
                        id: log.id,
                        archived: true,
                        archivedAt: autoArchivedTimestamp
                    }));
                    updateActivityLogsAPI(state.currentOrganization.id, updates);
                });
            }
            
            const autoArchivedLogs = state.activityLogs.map(log => {
                if (log.archived) return log; // Skip already archived logs
                
                const logDate = new Date(log.timestamp);
                if (logDate < oneHourAgo) {
                    return {
                        ...log,
                        archived: true,
                        archivedAt: autoArchivedTimestamp
                    };
                }
                return log;
            });
            
            console.log(`🕐 Auto-archived ${logsToAutoArchive.length} old logs`);
            return { ...state, activityLogs: autoArchivedLogs };
        case 'SET_SELECTED_ITEM':
            return { ...state, selectedItemId: action.payload };
        case 'SET_CATEGORIES':
            return { ...state, categories: action.payload };
        default:
            return state;
    }
};

const AppContext = createContext<{
    state: AppState;
    dispatch: React.Dispatch<Action>;
    setView: (view: View) => void;
    currentView: View;
    previousView: View;
    selectItem: (itemId: string | null) => void;
    goBack: () => void;
    handleAddItem: (itemData: Omit<InventoryItem, 'id' | 'organizationId'>) => Promise<void>;
    handleUpdateItem: (updatedItem: InventoryItem) => Promise<void>;
    handleDeleteItem: (itemId: string) => Promise<void>;
    handleUpdateUser: (updatedUser: User) => Promise<void>;
    handleDeleteUser: (uid: string) => Promise<void>;
    handleAddUser: (userData: Omit<User, 'organizationId' | 'uid'>, password?: string) => Promise<void>;
    handleUpdateCategories: (categories: string[]) => Promise<void>;
    handleRenameCategory: (oldName: string, newName: string) => Promise<boolean>;
    handleDeleteCategory: (categoryName: string) => Promise<void>;
    handleUpdateIntegration: (integration: string, status: string) => Promise<void>;
    handleUpdateSubscription: (plan: string, status: string) => Promise<void>;
    handleDeleteAllData: () => Promise<void>;
}>({
    state: {} as AppState, // Will be initialized in the provider
    dispatch: () => null,
    setView: () => null,
    currentView: View.Dashboard,
    previousView: View.Dashboard,
    selectItem: () => {},
    goBack: () => {},
    handleAddItem: async () => {},
    handleUpdateItem: async () => {},
    handleDeleteItem: async () => {},
    handleUpdateUser: async () => {},
    handleDeleteUser: async () => {},
    handleAddUser: async () => {},
    handleUpdateCategories: async () => {},
    handleRenameCategory: async () => false,
    handleDeleteCategory: async () => {},
    handleUpdateIntegration: async () => {},
    handleUpdateSubscription: async () => {},
    handleDeleteAllData: async () => {},
});

const genericInitialState: Omit<AppState, 'currentUser' | 'currentOrganization' | 'settings'> = {
    inventory: [],
    users: [],
    categories: [],
    activityLogs: [],
    selectedItemId: null,
    loading: {
        inventory: true,
        users: true,
        suggestions: false,
        sync: false,
    },
    error: null,
};


export const AppProvider: React.FC<{ children: ReactNode, user: User, organization: Organization }> = ({ children, user, organization }) => {
    
    const initializeState = useCallback((): AppState => {
        const defaults: Settings = {
            lowStockThreshold: 10,
            notificationSettings: {
                enabled: true,
                target: 'mostUsed',
                mostUsedCount: 100,
            },
            // Theme resolution order: dedicated key (survives org-switch data clears)
            // → user's saved profile preference → light (the app default).
            theme: ((): 'light' | 'dark' => {
                try {
                    const saved = localStorage.getItem('stockflow_theme');
                    if (saved === 'light' || saved === 'dark') return saved;
                } catch (_) {}
                return user.themePreference || 'light';
            })(),
            zohoSync: {
                frequency: 'daily',
                defaultCategory: '',
            },
            analytics: {
                autoRefresh: false,
                refreshInterval: 15,
                showAdvancedMetrics: false,
            }
        };
        let settings = defaults;
        try {
            // Check for user-specific settings first
            const userSpecificKey = `appSettings_${organization.id}_${user.uid}`;
            const orgSpecificKey = `appSettings_${organization.id}`;
            const storedSettings = localStorage.getItem(userSpecificKey) || localStorage.getItem(orgSpecificKey);
            
            if (storedSettings) {
                const parsed = JSON.parse(storedSettings);
                const mergedNotifications = { ...defaults.notificationSettings, ...parsed.notificationSettings };
                settings = { ...defaults, ...parsed, notificationSettings: mergedNotifications };
                
                // If user has a preference in DB, it should ideally win over old localStorage
                // but if they just changed it in THIS session/browser, localStorage is better.
                // We'll trust localStorage more for the immediate experience.
            }
        } catch (error) {
            console.error("Failed to parse settings from localStorage for org " + organization.id, error);
        }

        return {
            ...genericInitialState,
            currentUser: user,
            currentOrganization: organization,
            settings: settings,
            categories: organization.categories || [],
        };
    }, [user, organization]);
    
    const [state, dispatch] = useReducer(appReducer, initializeState());
    // Persist current view to localStorage
    const [currentView, setView] = React.useState<View>(() => {
        const saved = localStorage.getItem('currentView');
        // Validate that the saved value is a valid View enum value
        const validViews = Object.values(View);
        if (saved && validViews.includes(saved as View)) {
            console.log('AppContext: Loading saved view from localStorage:', saved);
            return saved as View;
        }
        console.log('AppContext: No valid saved view found, defaulting to Dashboard. Saved value was:', saved);
        return View.Dashboard;
    });
    const [previousView, setPreviousView] = React.useState<View>(View.Dashboard);
    const addToast = useToast();
    const addToastRef = React.useRef(addToast);
    // Track stock take session IDs we've already notified about, to avoid re-notifying on re-renders
    const seenStockTakeSessionIds = React.useRef<Set<string>>(new Set());

    React.useEffect(() => {
        addToastRef.current = addToast;
    }, [addToast]);
    
    const mostUsedItems = React.useMemo(() => {
        // This logic is now handled in the ReportsView with real data.
        // For notifications, we'll keep a simpler calculation or assume it's a backend job.
        // For now, let's keep it simple and not block UI rendering.
        return new Set<string>();
    }, []);


    const handleLowStockNotification = useCallback((item: InventoryItem) => {
        const { notificationSettings } = state.settings;
        if (!notificationSettings.enabled) return;
        
        // In a real app, the 'mostUsedItems' check would be done on a backend.
        // For the frontend, we'll simplify and notify for all low items if that setting is chosen,
        // or just log a placeholder if 'mostUsed' is selected.
        let shouldNotify = false;
        if (notificationSettings.target === 'all') {
            shouldNotify = true;
        } else if (notificationSettings.target === 'mostUsed') {
            // This would require fetching and processing all historical data,
            // which is too slow for an instant notification. This should be a backend feature.
            // For now, we'll assume the notification fires and the backend would filter.
             shouldNotify = true; // Let the backend decide
        }

        if (shouldNotify) {
            addToast({ message: `Email Alert: ${item.metadata?.description || item.name} is low on stock. Report sent.`, type: 'info' });
            api.sendLowStockEmailNotificationAPI(state.currentOrganization.id, [item], state.currentUser.email);
        }
    }, [state.settings, state.currentUser.email, addToast]);

    const setupRealtimeListeners = useCallback((orgId: string) => {
        const unsubscribeFunctions: Unsubscribe[] = [];

        if (!orgId || orgId === 'undefined') {
            console.error('Invalid organization ID for real-time listeners:', orgId);
            return () => {};
        }

        // 1. Real-time inventory updates
        const inventoryPath = `organizations/${orgId}/inventory`;
        const inventoryQuery = query(
            collection(firestore, inventoryPath),
            orderBy('updatedAt', 'desc')
        );
        
        const unsubscribeInventory = onSnapshot(inventoryQuery, (snapshot) => {
            const updatedInventory: InventoryItem[] = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                updatedInventory.push({
                    id: doc.id,
                    ...data,
                    lastUpdated: data.lastUpdated?.toDate?.() || new Date()
                } as unknown as InventoryItem);
            });
            
            dispatch({ type: 'SET_INVENTORY', payload: sortByUsage(updatedInventory) });
            
        }, (error) => {
            console.error('Real-time inventory listener error:', error.message);
        });
        unsubscribeFunctions.push(unsubscribeInventory);

        // 2. Real-time activity logs updates
        const logsQuery = query(
            collection(firestore, `organizations/${orgId}/activityLogs`),
            orderBy('timestamp', 'desc'),
            limit(200)
        );
        const unsubscribeLogs = onSnapshot(logsQuery, (snapshot) => {
            const updatedLogs: ActivityLogEntry[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                
                // Get actual username by looking up in users - use current state users
                const actualUsername = data.user || data.userName || getUserDisplayName(data.userId, state.users);
                
                // Transform APK logs to dashboard format for compatibility
                const transformedLog = {
                    id: doc.id,
                    ...data,
                    // Use actual display names like dashboard logs
                    user: actualUsername,
                    userName: actualUsername,
                    organizationId: data.organizationId || data.orgId,
                    timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp || new Date().toISOString(),
                    // Preserve APK fields for detection
                    source: data.source,
                    itemId: data.itemId,
                    itemName: data.itemName,
                    quantity: data.quantity
                } as unknown as ActivityLogEntry;
                
                updatedLogs.push(transformedLog);
            });
            
            dispatch({ 
                type: 'SET_ACTIVITY_LOGS', 
                payload: updatedLogs
            });
        }, (error) => {
            console.error('❌ Real-time activity logs listener error:', error);
        });
        unsubscribeFunctions.push(unsubscribeLogs);

        // 3. Real-time users updates
        const usersQuery = query(
            collection(firestore, `organizations/${orgId}/users`),
            orderBy('createdAt', 'desc')
        );
        const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
            const updatedUsers: User[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                updatedUsers.push({
                    uid: doc.id,
                    ...data
                } as User);
            });
            
            console.log('👥 Real-time users update:', updatedUsers.length, 'users');
            // Update only users in state
            dispatch({ 
                type: 'SET_USERS', 
                payload: updatedUsers
            });
        }, (error) => {
            console.error('❌ Real-time users listener error:', error);
        });
        unsubscribeFunctions.push(unsubscribeUsers);

        // 4. Real-time organization updates (for categories, settings, etc.)
        const orgDoc = doc(firestore, `organizations/${orgId}`);
        const unsubscribeOrg = onSnapshot(orgDoc, (snapshot) => {
            if (snapshot.exists()) {
                const orgData = snapshot.data();
                console.log('🏢 Real-time organization update');
                dispatch({ 
                    type: 'UPDATE_ORGANIZATION', 
                    payload: {
                        categories: orgData.categories || [],
                        ...orgData
                    }
                });
                
                // Update categories in state
                if (orgData.categories) {
                    dispatch({ type: 'SET_CATEGORIES', payload: orgData.categories });
                }
            }
        }, (error) => {
            console.error('❌ Real-time organization listener error:', error);
        });
        unsubscribeFunctions.push(unsubscribeOrg);

        // 5. Real-time stock take sessions (for approvals and monitoring)
        const stockTakeQuery = query(
            collection(firestore, `organizations/${orgId}/stockTakeSessions`),
            orderBy('createdAt', 'desc'),
            limit(50)
        );
        const unsubscribeStockTake = onSnapshot(stockTakeQuery, (snapshot) => {
            const stockTakeSessions: any[] = [];
            snapshot.forEach(doc => {
                stockTakeSessions.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            // Detect newly-started APK sessions (status ACTIVE that we haven't seen before)
            const newActiveSessions = stockTakeSessions.filter(
                s => s.status === 'ACTIVE' && !seenStockTakeSessionIds.current.has(s.id)
            );
            // Mark all current sessions as seen
            stockTakeSessions.forEach(s => seenStockTakeSessionIds.current.add(s.id));

            // Fire a notification for each new ACTIVE session (non-blocking)
            if (newActiveSessions.length > 0) {
                newActiveSessions.forEach(async (session) => {
                    try {
                        const notifService = (await import('../services/notificationService')).default;
                        // Only ever show the human-readable device model name.
                        // Never the raw hex device ID, and never repeat the username here.
                        const deviceLabel = session.deviceName || 'a mobile device';
                        await notifService.createNotification(orgId, {
                            type: 'stock_take_session' as any,
                            title: 'Stock Take Started',
                            message: `${session.userName || 'A mobile user'} started a stock take on ${deviceLabel}. Review in Stock Take Monitor.`,
                            targetUserId: 'ALL',
                            priority: 'high',
                            link: '/stock-take-monitor',
                            metadata: {
                                sessionId: session.id,
                                deviceId: session.deviceId,
                                deviceName: session.deviceName,
                                userName: session.userName,
                                startTime: session.startTime,
                                source: 'apk',
                                eventType: 'STARTED'
                            }
                        } as any);
                        console.log('🔔 Notification created for new stock take session:', session.id);
                    } catch (e) {
                        console.warn('⚠️ Failed to create stock take notification:', e);
                    }
                });
            }

            console.log('📊 Real-time stock take sessions update:', stockTakeSessions.length, 'sessions');
            // Store in global state or emit event for components that need it
            window.dispatchEvent(new CustomEvent('stockTakeSessionsUpdate', { 
                detail: stockTakeSessions 
            }));
        }, (error) => {
            console.error('❌ Real-time stock take sessions listener error:', error);
        });
        unsubscribeFunctions.push(unsubscribeStockTake);

        // 6. Real-time approval updates (dashboard + APK parity)
        const approvalsQuery = query(
            collection(firestore, `organizations/${orgId}/approvals`),
            orderBy('requestedAt', 'desc'),
            limit(200)
        );
        const unsubscribeApprovals = onSnapshot(approvalsQuery, (snapshot) => {
            const approvals: ApprovalRequest[] = [];
            snapshot.forEach(docSnap => {
                approvals.push({
                    id: docSnap.id,
                    ...docSnap.data()
                } as ApprovalRequest);
            });
            console.log('📨 Real-time approvals update:', approvals.length);
            window.dispatchEvent(new CustomEvent('approvalsUpdate', {
                detail: approvals
            }));
        }, (error) => {
            console.error('❌ Real-time approvals listener error:', error);
        });
        unsubscribeFunctions.push(unsubscribeApprovals);

        // Store unsubscribe functions for cleanup
        return () => {
            unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
        };
    }, []);

    // Activity stream removed - RTDB deleted, using Firestore activity logs only

    useEffect(() => {
        let cleanupRealtimeListeners: (() => void) | null = null;
        
        const loadData = async () => {
            try {
                dispatch({ type: 'SET_ERROR', payload: null });
                console.log('🏢 Loading organization data for:', organization.name);
                
                // Add small delay to ensure Firestore data is consistent
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const data = await api.getOrganizationData(organization.id);
                console.log('✅ Organization data loaded successfully:', data.inventory.length, 'items,', data.users.length, 'users,', data.activityLogs.length, 'logs');
            
                // Normalize timestamps on initial logs
                const normalizedLogs = data.activityLogs.map(l => ({
                    ...l,
                    timestamp: (typeof l.timestamp === 'string')
                        ? l.timestamp
                        : ((l as any).timestamp?.toDate?.() ? (l as any).timestamp.toDate().toISOString() : new Date(String(l.timestamp)).toISOString())
                }));

                dispatch({ 
                    type: 'SET_INITIAL_DATA', 
                    payload: {
                        inventory: data.inventory,
                        users: data.users,
                        activityLogs: normalizedLogs,
                        organization: organization
                    }
                });

                console.log('✅ Organization data loaded successfully');

                cleanupRealtimeListeners = setupRealtimeListeners(organization.id);

            } catch (error: any) {
                console.error('❌ Failed to load organization data:', error);
                const message = error.message.includes('not found') 
                    ? 'Organization setup in progress. Please refresh if this persists.'
                    : 'Failed to load organization data.';
                dispatch({ type: 'SET_ERROR', payload: message });
                addToastRef.current({ message, type: 'error' });
            }
        };
        
        // Only load data if we have a valid organization ID
        if (organization && organization.id) {
            loadData();
        }

        // Cleanup on unmount or organization change
        return () => {
            if (cleanupRealtimeListeners) {
                cleanupRealtimeListeners();
            }
        };
    }, [organization?.id, user.uid, setupRealtimeListeners]);

    // Auto-archive logs older than 1 hour every 5 minutes
    useEffect(() => {
        const autoArchiveInterval = setInterval(() => {
            dispatch({ type: 'ARCHIVE_OLD_LOGS' });
        }, 5 * 60 * 1000); // Run every 5 minutes

        // Run immediately on mount
        const timeoutId = setTimeout(() => {
            dispatch({ type: 'ARCHIVE_OLD_LOGS' });
        }, 10 * 1000); // Wait 10 seconds after load

        return () => {
            clearInterval(autoArchiveInterval);
            clearTimeout(timeoutId);
        };
    }, []); // No dependencies - should run once and set up the interval

    // Activity stream removed - backend deleted
    
     useEffect(() => {
        // Apply theme on initial load and changes
        const root = document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(state.settings.theme);
        
        // Update body background
        document.body.className = state.settings.theme === 'dark' 
            ? 'bg-gray-900 text-gray-100' 
            : 'bg-gray-100 text-gray-900';
    }, [state.settings.theme]);

    const setViewWithHistory = useCallback((view: View) => {
        if (view !== currentView) {
            setPreviousView(currentView);
            setView(view);
            localStorage.setItem('currentView', view);
        }
    }, [currentView]);

    const goBack = useCallback(() => {
        setView(previousView);
        localStorage.setItem('currentView', previousView);
    }, [previousView]);

    const selectItem = useCallback((itemId: string | null) => {
        dispatch({ type: 'SET_SELECTED_ITEM', payload: itemId });
        if (itemId) {
            // Track that we're coming from the current view to item detail
            if (currentView !== View.ItemDetail) {
                setPreviousView(currentView);
            }
            setView(View.ItemDetail);
            localStorage.setItem('currentView', View.ItemDetail);
        } else {
            // Go back to where we came from
            setView(previousView);
            localStorage.setItem('currentView', previousView);
        }
    }, [currentView, previousView]);
    
    const handleUpdateCategories = useCallback(async (categories: string[]) => {
        const cleanedCategories = categories
            .map(category => category.trim())
            .filter(category => category.length > 0);
        const uniqueSortedCategories = [...new Set(cleanedCategories)].sort((a, b) => a.localeCompare(b));

        try {
            await api.updateCategoriesAPI(state.currentOrganization.id, uniqueSortedCategories);
            dispatch({ type: 'SET_CATEGORIES', payload: uniqueSortedCategories });
            dispatch({ type: 'UPDATE_ORGANIZATION', payload: { categories: uniqueSortedCategories } });
            addToast({ message: 'Categories saved successfully!', type: 'success' });
        } catch (error) {
            console.error('Failed to save categories:', error);
            addToast({ message: 'Failed to save categories.', type: 'error' });
        }
    }, [addToast, state.currentOrganization.id]);
    

    const handleAddItem = useCallback(async (itemData: Omit<InventoryItem, 'id' | 'organizationId'>, bypassDuplicateCheck: boolean = false) => {
        const newItemData = { ...itemData, organizationId: state.currentOrganization.id };
        try {
            const newItem = await api.addInventoryItem(newItemData, state.currentOrganization.id);

            dispatch({ type: 'ADD_ITEM', payload: newItem });
            dispatch({ type: 'ADD_LOG', payload: { 
                user: state.currentUser.email, 
                action: `Added item: ${newItem.metadata?.description || newItem.name}`,
                details: `Item: ${newItem.sku || 'No SKU'} | Initial stock: ${newItem.stock}`
            }});
            
            addToast({ message: 'Item added successfully!', type: 'success' });
            
            if (!state.categories.includes(newItem.category)) {
                handleUpdateCategories([...state.categories, newItem.category]);
            }

            if (newItem.stock <= newItem.threshold) {
                handleLowStockNotification(newItem);
            }

            // POS write-back: if POS is connected, create the product there too
            const isPosConnected = state.currentOrganization?.integrations?.pos?.status === 'connected';
            if (isPosConnected) {
                try {
                    const { PosService } = await import('../services/posService');
                    const { posId } = await PosService.createProduct(state.currentOrganization.id, {
                        name: newItem.name,
                        sku: newItem.sku,
                        price: newItem.price,
                        cost: newItem.cost,
                        category: newItem.category,
                    });
                    // Store the posId back on the Firestore item
                    const itemWithPosId = { ...newItem, posId, posProvider: state.currentOrganization.integrations.pos?.provider };
                    await api.updateInventoryItem(itemWithPosId, state.currentOrganization.id);
                    dispatch({ type: 'UPDATE_ITEM', payload: itemWithPosId });
                    addToast({ message: `✅ Item also created in POS (ID: ${posId})`, type: 'success' });
                } catch (posError: any) {
                    console.warn('⚠️ POS create product failed (non-blocking):', posError.message);
                    addToast({ message: `⚠️ Item saved locally but POS sync failed: ${posError.message}`, type: 'info' });
                }
            }

        } catch (error: any) {
            const errorMessage = error.message || 'Failed to add item.';
            addToast({ message: errorMessage, type: 'error' });
        }
    }, [addToast, state.currentUser.email, state.currentOrganization.id, state.categories, handleLowStockNotification, handleUpdateCategories]);

    const handleUpdateItem = useCallback(async (updatedItem: InventoryItem, bypassDuplicateCheck: boolean = false) => {
        try {
            const oldItem = state.inventory.find((i: InventoryItem) => i.id === updatedItem.id);
            
            // Check if Zoho is connected and this is a stock change
            const isZohoConnected = state.currentOrganization?.integrations?.zoho?.status === 'connected';
            const isStockChange = oldItem && oldItem.stock !== updatedItem.stock;
            
            // If Zoho is connected and stock changed, create approval request instead of direct update
            if (isZohoConnected && isStockChange) {
                const { createApprovalRequest } = await import('../services/apiService');
                const quantityDelta = updatedItem.stock - oldItem.stock;
                
                await createApprovalRequest(state.currentOrganization.id, {
                    type: 'zoho_sync',
                    action: 'adjust_stock',
                    itemId: updatedItem.id,
                    itemName: updatedItem.name,
                    itemSKU: updatedItem.sku,
                    requestedBy: state.currentUser.uid || state.currentUser.email,
                    requestedByName: state.currentUser.name || state.currentUser.email,
                    requestedChange: {
                        quantityDelta,
                        newQuantity: updatedItem.stock,
                        reason: 'Dashboard stock update'
                    },
                    source: 'dashboard'
                });
                
                addToast({ 
                    message: `📋 Stock change sent for approval: ${updatedItem.name} (${oldItem.stock} → ${updatedItem.stock}). Dashboard shows pending changes.`, 
                    type: 'info' 
                });
                
                // Update UI immediately to show pending change (with visual indicator)
                const pendingItem = { ...updatedItem, pendingApproval: true };
                dispatch({ type: 'UPDATE_ITEM', payload: pendingItem });
                
                // Still log locally for visibility
                dispatch({ type: 'ADD_LOG', payload: {
                    user: state.currentUser.email,
                    action: `Requested approval: Stock change for ${updatedItem.name} (${oldItem.stock} → ${updatedItem.stock})`,
                    details: {
                        itemId: updatedItem.id,
                        itemName: updatedItem.name,
                        change: { field: 'stock', from: oldItem.stock, to: updatedItem.stock }
                    }
                }});
                
                return;
            }
            
            // Use enhanced API that can integrate with backend
            await updateItemWithBackend(updatedItem, state.currentOrganization.id, oldItem);
            dispatch({ type: 'UPDATE_ITEM', payload: updatedItem });

            if (oldItem && oldItem.stock !== updatedItem.stock) {
                dispatch({ type: 'ADD_LOG', payload: {
                    user: state.currentUser.email,
                    action: `Updated stock for ${updatedItem.metadata?.description || updatedItem.name}`,
                    details: `Item: ${updatedItem.sku || 'No SKU'} | Stock: ${oldItem.stock} → ${updatedItem.stock}`
                }});

            } else {
                dispatch({ type: 'ADD_LOG', payload: { user: state.currentUser.email, action: `Updated details for ${updatedItem.metadata?.description || updatedItem.name}` }});
            }

            addToast({ message: 'Item updated successfully!', type: 'success' });

            if (!state.categories.includes(updatedItem.category)) {
                handleUpdateCategories([...state.categories, updatedItem.category]);
            }

            if (updatedItem.stock <= updatedItem.threshold) {
                if (!oldItem || oldItem.stock > oldItem.threshold) {
                    handleLowStockNotification(updatedItem);
                }
            }

            // POS write-back: sync stock and metadata changes to connected POS
            const isPosConnectedForUpdate = state.currentOrganization?.integrations?.pos?.status === 'connected';
            const hasPosId = !!(updatedItem as any).posId;
            if (isPosConnectedForUpdate && hasPosId) {
                try {
                    const { PosService } = await import('../services/posService');
                    const posId = (updatedItem as any).posId as string;
                    const orgId = state.currentOrganization.id;

                    // Sync stock quantity if it changed
                    if (oldItem && oldItem.stock !== updatedItem.stock) {
                        await PosService.adjustInventory(orgId, posId, updatedItem.stock, 'StockFlow dashboard update');
                    }

                    // Sync metadata changes (name, price, cost, sku)
                    const metaChanged = oldItem && (
                        oldItem.name !== updatedItem.name ||
                        oldItem.price !== updatedItem.price ||
                        oldItem.cost !== updatedItem.cost ||
                        oldItem.sku !== updatedItem.sku
                    );
                    if (metaChanged) {
                        await PosService.updateProduct(orgId, posId, {
                            name: updatedItem.name,
                            sku: updatedItem.sku,
                            price: updatedItem.price,
                            cost: updatedItem.cost,
                        });
                    }

                    console.log(`✅ POS synced for item ${updatedItem.name} (posId: ${posId})`);
                } catch (posError: any) {
                    console.warn('⚠️ POS sync failed (non-blocking):', posError.message);
                    addToast({ message: `⚠️ Saved locally. POS sync failed: ${posError.message}`, type: 'info' });
                }
            }
        } catch (error: any) {
            const errorMessage = error.message || 'Failed to update item.';
            addToast({ message: errorMessage, type: 'error' });
        }
    }, [addToast, state.currentUser, state.inventory, state.currentOrganization, state.categories, handleLowStockNotification, handleUpdateCategories]);
    
    const handleDeleteItem = useCallback(async (itemId: string) => {
        const itemToDelete = state.inventory.find((i: InventoryItem) => i.id === itemId);
        if (!itemToDelete) return;

        try {
            // POS write-back: archive in POS before removing locally
            const isPosConnectedForDelete = state.currentOrganization?.integrations?.pos?.status === 'connected';
            const itemPosId = (itemToDelete as any).posId as string | undefined;
            if (isPosConnectedForDelete && itemPosId) {
                try {
                    const { PosService } = await import('../services/posService');
                    await PosService.deleteProduct(state.currentOrganization.id, itemPosId);
                    console.log(`✅ POS product archived (posId: ${itemPosId})`);
                } catch (posError: any) {
                    console.warn('⚠️ POS delete failed (non-blocking):', posError.message);
                    addToast({ message: `⚠️ POS archive failed: ${posError.message}`, type: 'info' });
                }
            }

            await api.deleteInventoryItem(itemId, state.currentOrganization.id);
            dispatch({ type: 'DELETE_ITEM', payload: itemId });
            dispatch({ type: 'ADD_LOG', payload: { 
                user: state.currentUser.email, 
                action: `Deleted item: ${itemToDelete.name}`,
                details: `Item: ${itemToDelete.sku || 'No SKU'} | Final stock was: ${itemToDelete.stock}`
            }});
            
            addToast({ message: 'Item deleted successfully!', type: 'success' });
        } catch {
            addToast({ message: 'Failed to delete item.', type: 'error' });
        }
    }, [addToast, state.currentUser.email, state.inventory, state.currentOrganization]);

    const handleUpdateUser = useCallback(async (updatedUser: User) => {
        try {
            const originalUser = state.users.find((u: User) => u.uid === updatedUser.uid);
            
            await api.updateUserInOrganization(updatedUser);
            dispatch({ type: 'UPDATE_USER', payload: updatedUser });
            
            // Create detailed change information
            const changes = [];
            if (originalUser) {
                if (originalUser.name !== updatedUser.name) {
                    changes.push(`Name: ${originalUser.name || 'Not set'} → ${updatedUser.name || 'Not set'}`);
                }
                if (originalUser.email !== updatedUser.email) {
                    changes.push(`Email: ${originalUser.email} → ${updatedUser.email}`);
                }
                if (originalUser.role !== updatedUser.role) {
                    changes.push(`Role: ${originalUser.role} → ${updatedUser.role}`);
                }
            }
            
            const detailsText = changes.length > 0 ? changes.join(' | ') : 'Profile updated';
            
            dispatch({ type: 'ADD_LOG', payload: { 
                user: state.currentUser.email, 
                action: `Updated user profile: ${updatedUser.email}`,
                details: detailsText
            }});
            
            // Enhanced activity logging with structured data
            try {
                if (originalUser) {
                    await activityLogger.log(state.currentOrganization.id, {
                        action: 'UPDATE_USER_PROFILE',
                        category: 'USER_MANAGEMENT',
                        description: `Updated profile for ${updatedUser.email}`,
                        targetType: 'user',
                        targetName: updatedUser.email,
                        previousValue: {
                            name: originalUser.name,
                            email: originalUser.email,
                            role: originalUser.role
                        },
                        newValue: {
                            name: updatedUser.name,
                            email: updatedUser.email,
                            role: updatedUser.role
                        },
                        metadata: {
                            changedFields: changes
                        }
                    });
                }
            } catch (logError) {
                console.warn('⚠️ Failed to log user profile update:', logError);
            }
            
            addToast({ message: 'User updated successfully!', type: 'success' });
        } catch {
            addToast({ message: 'Failed to update user.', type: 'error' });
        }
    }, [addToast, state.currentUser.email, state.currentOrganization.id, state.users]);

    const handleDeleteUser = useCallback(async (uid: string) => {
        const userToDelete = state.users.find((u: User) => u.uid === uid);
        if (!userToDelete) return;
        try {
            await api.removeUserFromOrganization(uid, state.currentOrganization.id);
            dispatch({ type: 'DELETE_USER', payload: uid });
            dispatch({ type: 'ADD_LOG', payload: { user: state.currentUser.email, action: `Deleted user: ${userToDelete.email}` }});
            addToast({ message: 'User deleted successfully!', type: 'success' });
        } catch {
            addToast({ message: 'Failed to delete user.', type: 'error' });
        }
    }, [addToast, state.currentUser.email, state.users, state.currentOrganization.id]);

    const handleAddUser = useCallback(async (userData: Omit<User, 'organizationId' | 'uid'>, password?: string) => {
        try {
            const newUser = await api.createUserWithOrganization(userData, state.currentOrganization.id, password);
            dispatch({ type: 'ADD_USER', payload: newUser });
            dispatch({ type: 'ADD_LOG', payload: { 
                user: state.currentUser.name || state.currentUser.email, 
                action: 'Created New User',
                details: newUser.email
            }});
            
            // 📡 BROADCAST NOTIFICATION for new user creation
            try {
                const { notificationService } = await import('../services/notificationService');
                await notificationService.notifySystem(
                    state.currentOrganization.id,
                    'New User Added',
                    `${newUser.email} has been added to the organization by ${state.currentUser.name || state.currentUser.email}`
                );
            } catch (notifError) {
                console.error('❌ Failed to broadcast user creation notification:', notifError);
            }
            
            addToast({ message: `User account created successfully! ${newUser.email} can now sign in.`, type: 'success' });
        } catch (error: any) {
            console.error('Failed to add user:', error);
            if (error.code === 'auth/email-already-in-use') {
                addToast({ message: 'This email is already registered in the system.', type: 'error' });
            } else if (error.code === 'auth/weak-password') {
                addToast({ message: 'Password is too weak. Please choose a stronger password.', type: 'error' });
            } else {
                addToast({ message: error.message || 'Failed to create user account.', type: 'error' });
            }
            throw error;
        }
    }, [addToast, state.currentUser.email, state.currentOrganization.id]);
    
    const handleRenameCategory = useCallback(async (oldName: string, newName: string): Promise<boolean> => {
        const trimmedNewName = newName.trim();
        if (oldName === trimmedNewName) return true;
        if (!trimmedNewName) {
            addToast({ message: 'Category name cannot be empty.', type: 'error' });
            return false;
        }
        if (state.categories.map((c: string) => c.toLowerCase()).includes(trimmedNewName.toLowerCase())) {
            addToast({ message: `Category "${trimmedNewName}" already exists.`, type: 'error' });
            return false;
        }
        
        const newCategories = state.categories
            .map((c: string) => (c === oldName ? trimmedNewName : c))
            .sort((a: string, b: string) => a.localeCompare(b));
        
        try {
            await api.renameCategoryInItemsAPI(state.currentOrganization.id, oldName, trimmedNewName);
            await api.updateCategoriesAPI(state.currentOrganization.id, newCategories);
            dispatch({ type: 'SET_CATEGORIES', payload: newCategories });
            dispatch({ type: 'UPDATE_ORGANIZATION', payload: { categories: newCategories } });
            state.inventory.forEach((item: InventoryItem) => {
                if (item.category === oldName) {
                    dispatch({ type: 'UPDATE_ITEM', payload: { ...item, category: trimmedNewName } });
                }
            });

            addToast({ message: 'Category renamed successfully!', type: 'success' });
            return true;
        } catch (error) {
            console.error('Failed to rename category:', error);
            addToast({ message: 'Failed to rename category.', type: 'error' });
            return false;
        }
    }, [state.categories, state.inventory, state.currentOrganization.id, addToast]);

    const handleDeleteCategory = useCallback(async (categoryName: string) => {
        const defaultCategory = state.settings.zohoSync.defaultCategory || '';
        if (categoryName === defaultCategory && defaultCategory !== '') {
            addToast({ message: 'Cannot delete the default category.', type: 'error' });
            return;
        }

        const newCategories = state.categories.filter((c: string) => c !== categoryName);
        
        try {
            await api.renameCategoryInItemsAPI(state.currentOrganization.id, categoryName, defaultCategory);
            await api.updateCategoriesAPI(state.currentOrganization.id, newCategories);
            dispatch({ type: 'SET_CATEGORIES', payload: newCategories });
            dispatch({ type: 'UPDATE_ORGANIZATION', payload: { categories: newCategories } });
            state.inventory.forEach((item: InventoryItem) => {
                if (item.category === categoryName) {
                    dispatch({ type: 'UPDATE_ITEM', payload: { ...item, category: defaultCategory } });
                }
            });
            addToast({ message: `Category '${categoryName}' deleted. Items moved to '${defaultCategory}'.`, type: 'success' });
        } catch (error) {
            console.error('Failed to delete category:', error);
            addToast({ message: 'Failed to delete category.', type: 'error' });
        }
    }, [state.categories, state.inventory, state.settings.zohoSync.defaultCategory, state.currentOrganization.id, addToast]);

    // Organization management functions
    const handleUpdateIntegration = useCallback(async (integration: string, status: string) => {
        try {
            if (integration === 'zoho') {
                const connectedAt = status === 'connected' ? new Date().toISOString() : null;
                await api.updateOrganizationIntegrations(state.currentOrganization.id, {
                    zoho: { status: status as any, connectedAt }
                });
                
                // Create payload without undefined values
                const zohoPayload: any = { status: status as any };
                if (connectedAt) {
                    zohoPayload.connectedAt = connectedAt;
                }
                
                dispatch({ 
                    type: 'UPDATE_INTEGRATION', 
                    payload: { zoho: zohoPayload }
                });
                
                addToast({ 
                    message: `Zoho ${status === 'connected' ? 'connected' : 'disconnected'} successfully!`, 
                    type: 'success' 
                });
                
                // If connecting, simulate data import
                if (status === 'connected') {
                    setTimeout(() => {
                        addToast({ 
                            message: 'Zoho integration complete! Data syncing...', 
                            type: 'info' 
                        });
                    }, 1000);
                }
            }
        } catch (error) {
            addToast({ message: 'Failed to update integration.', type: 'error' });
        }
    }, [state.currentOrganization.id, addToast]);
    
    const handleDeleteAllData = useCallback(async () => {
        try {
            console.log('🗑️ Starting data deletion for organization:', state.currentOrganization.id);
            console.log('📊 Current inventory count:', state.inventory.length);
            console.log('📋 Current activity logs count:', state.activityLogs.length);
            
            // Delete all organization data from Firebase
            await api.deleteAllOrganizationData(state.currentOrganization.id);
            
            console.log('✅ Database deletion completed, updating local state...');
            
            // Clear inventory and activity logs from state
            dispatch({ type: 'SET_INVENTORY', payload: [] });
            dispatch({ type: 'SET_ACTIVITY_LOGS', payload: [] });
            
            console.log('✅ Local state cleared successfully');
            
            addToast({ 
                message: 'All organization data has been deleted successfully!', 
                type: 'success' 
            });
            
        } catch (error) {
            console.error('❌ Error deleting organization data:', error);
            addToast({ 
                message: `Failed to delete organization data: ${(error as any).message || 'Unknown error'}`, 
                type: 'error' 
            });
        }
    }, [state.currentOrganization.id, addToast]);
    
    const handleUpdateSubscription = useCallback(async (plan: string, status: string) => {
        try {
            // Implement subscription update with proper cancellation handling
            if (!state.currentOrganization?.id) {
                throw new Error('No organization selected');
            }

            const orgRef = doc(firestore, 'organizations', state.currentOrganization.id);
            let endDate: string;

            // Handle downgrade - cancel existing subscription if needed
            if (plan === 'Free' && state.currentOrganization.subscription?.plan !== 'Free') {
                console.log('🔄 Canceling existing subscription for downgrade to Free plan');
                
                endDate = state.currentOrganization.subscription?.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                // Mark subscription as cancelled but keep it active until period end
                const cancelledSubscription = {
                    plan: 'Free',
                    status: 'active', // Keep active until current period ends
                    startDate: new Date().toISOString(),
                    endDate,
                    cancelledAt: new Date().toISOString(),
                    previousPlan: state.currentOrganization.subscription?.plan || 'Unknown'
                };
                
                await updateDoc(orgRef, {
                    subscription: cancelledSubscription,
                    updatedAt: serverTimestamp()
                });
            } else {
                // Regular subscription update
                endDate = plan === 'Free' 
                    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
                
                const updatedSubscription = {
                    plan,
                    status,
                    startDate: new Date().toISOString(),
                    endDate
                };
                
                await updateDoc(orgRef, {
                    subscription: updatedSubscription,
                    updatedAt: serverTimestamp()
                });
            }
            
            dispatch({ 
                type: 'UPDATE_SUBSCRIPTION', 
                payload: { plan: plan as any, status: status as any, endDate }
            });
            
            addToast({ 
                message: `Subscription updated to ${plan} plan!`, 
                type: 'success' 
            });
        } catch (error) {
            addToast({ message: 'Failed to update subscription.', type: 'error' });
        }
    }, [state.currentOrganization.id, addToast]);


    return (
        <AppContext.Provider value={{ 
            state,
            dispatch,
            setView: setViewWithHistory,
            currentView,
            previousView,
            selectItem,
            goBack,
            handleAddItem, 
            handleUpdateItem, 
            handleDeleteItem, 
            handleUpdateUser, 
            handleDeleteUser, 
            handleAddUser, 
            handleUpdateCategories, 
            handleRenameCategory, 
            handleDeleteCategory,
            handleUpdateIntegration,
            handleDeleteAllData,
            handleUpdateSubscription
        }}>
            {children}
        </AppContext.Provider>
    );
};

export const useAppContext = () => useContext(AppContext);