import { useState, useEffect, useCallback } from 'react';
import stockTakeService, { StockTakeSession, ScannedItem } from '../services/stockTakeService';
import { useAppContext } from '../context/AppContext';

export interface StockTakeHookReturn {
  activeSession: StockTakeSession | null;
  isSessionActive: boolean;
  startStockTakeSession: () => Promise<string | null>;
  endStockTakeSession: (sessionId: string) => Promise<boolean>;
  getSessionSummary: () => Promise<any>;
  sendTestNotification: () => void;
  notifications: any[];
  getAllSessions: () => Promise<StockTakeSession[]>;
  allSessions: StockTakeSession[];
}

/**
 * Hook for stock take session management (Firestore-based)
 */
export function useStockTake(): StockTakeHookReturn {
  const { state } = useAppContext();
  const [activeSession, setActiveSession] = useState<StockTakeSession | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [allSessions, setAllSessions] = useState<StockTakeSession[]>([]);

  // Subscribe to active session
  useEffect(() => {
    if (!state.currentOrganization?.id || !state.currentUser?.uid) {
      return;
    }

    const unsubscribe = stockTakeService.subscribeToActiveSession(
      state.currentOrganization.id,
      state.currentUser.uid,
      (session) => {
        setActiveSession(session);
        setIsSessionActive(session !== null && session.status === 'ACTIVE');
      }
    );

    return () => {
      unsubscribe();
    };
  }, [state.currentOrganization?.id, state.currentUser?.uid]);

  // Subscribe to all sessions for debugging
  useEffect(() => {
    if (!state.currentOrganization?.id) {
      console.log('🔍 No current organization ID available');
      return;
    }

    console.log('🔍 Dashboard user info:');
    console.log('🔍 Current org ID:', state.currentOrganization.id);
    console.log('🔍 Current user ID:', state.currentUser?.uid);
    console.log('🔍 Current user email:', state.currentUser?.email);

    const unsubscribe = stockTakeService.subscribeToAllSessions(
      state.currentOrganization.id,
      (sessions) => {
        setAllSessions(sessions);
        console.log('🔍 All stock take sessions:', sessions);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [state.currentOrganization?.id]);

  const startStockTakeSession = useCallback(async (): Promise<string | null> => {
    if (!state.currentOrganization?.id || !state.currentUser?.uid) return null;

    try {
      const sessionId = await stockTakeService.startSession(
        state.currentOrganization.id,
        state.currentUser.uid,
        state.currentUser.name || state.currentUser.email,
        'dashboard'
      );
      return sessionId;
    } catch (error) {
      console.error('Failed to start stock take session:', error);
      return null;
    }
  }, [state.currentOrganization?.id, state.currentUser?.uid, state.currentUser?.name, state.currentUser?.email]);

  const endStockTakeSession = useCallback(async (sessionId: string): Promise<boolean> => {
    if (!state.currentOrganization?.id) return false;

    try {
      return await stockTakeService.endSession(state.currentOrganization.id, sessionId);
    } catch (error) {
      console.error('Failed to end stock take session:', error);
      return false;
    }
  }, [state.currentOrganization?.id]);

  const getSessionSummary = useCallback(async () => {
    if (!state.currentOrganization?.id || !activeSession?.id) return null;

    try {
      const summary = await stockTakeService.getSessionSummary(
        state.currentOrganization.id,
        activeSession.id
      );
      
      // Transform to match old format
      if (summary) {
        return {
          sessionId: summary.id,
          status: summary.status,
          startTime: summary.startTime,
          endTime: summary.endTime,
          itemsScanned: summary.itemsScanned,
          scannedItemsArray: summary.scannedItems || []
        };
      }
      return null;
    } catch (error) {
      console.error('Failed to get session summary:', error);
      return null;
    }
  }, [state.currentOrganization?.id, activeSession?.id]);

  const sendTestNotification = useCallback(() => {
    console.log('Test notification (Firestore-based stock take)');
  }, []);

  const getAllSessions = useCallback(async (): Promise<StockTakeSession[]> => {
    if (!state.currentOrganization?.id) return [];

    try {
      return await stockTakeService.getAllSessions(state.currentOrganization.id);
    } catch (error) {
      console.error('Failed to get all sessions:', error);
      return [];
    }
  }, [state.currentOrganization?.id]);

  return {
    activeSession,
    isSessionActive,
    startStockTakeSession,
    endStockTakeSession,
    getSessionSummary,
    sendTestNotification,
    getAllSessions,
    allSessions,
    notifications: []
  };
}

export default useStockTake;
