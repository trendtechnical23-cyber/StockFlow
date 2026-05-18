// Activity stream functionality removed - backend deleted, using direct Firebase only

import { useEffect } from 'react';
import { ActivityLogEntry } from '../types';

interface Options { 
  organizationId: string; 
  onEvent: (entry: ActivityLogEntry) => void; 
  getLastTimestamp?: () => string | undefined; 
  onReconnectBatch?: (entries: ActivityLogEntry[]) => void;
}

export function useActivityStream({ organizationId, onEvent, getLastTimestamp, onReconnectBatch }: Options) {
  useEffect(() => {
    // No more backend polling - functionality disabled
    console.log('🚫 Activity stream disabled - backend removed');
  }, [organizationId, onEvent]);
}