import { useState, useEffect, useCallback, useRef } from 'react';

interface UseIdleTimerOptions {
    timeout: number; // milliseconds
    onIdle?: () => void;
    onActive?: () => void;
    events?: string[];
    startOnMount?: boolean;
}

interface UseIdleTimerReturn {
    isIdle: boolean;
    start: () => void;
    stop: () => void;
    reset: () => void;
    getElapsedTime: () => number;
    getRemainingTime: () => number;
}

const DEFAULT_EVENTS = [
    'mousedown',
    'mousemove',
    'keypress',
    'scroll',
    'touchstart',
    'click',
    'wheel',
];

export const useIdleTimer = ({
    timeout,
    onIdle,
    onActive,
    events = DEFAULT_EVENTS,
    startOnMount = true,
}: UseIdleTimerOptions): UseIdleTimerReturn => {
    const [isIdle, setIsIdle] = useState(false);
    const [isRunning, setIsRunning] = useState(startOnMount);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const eventHandlerRef = useRef<() => void>();
    const startTimeRef = useRef<number>(Date.now());

    const reset = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        if (isRunning) {
            startTimeRef.current = Date.now();
            setIsIdle(false);
            
            timeoutRef.current = setTimeout(() => {
                setIsIdle(true);
                onIdle?.();
            }, timeout);
        }
    }, [timeout, onIdle, isRunning]);

    const start = useCallback(() => {
        setIsRunning(true);
        reset();
    }, [reset]);

    const stop = useCallback(() => {
        setIsRunning(false);
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setIsIdle(false);
    }, []);

    const getElapsedTime = useCallback(() => {
        return Date.now() - startTimeRef.current;
    }, []);

    const getRemainingTime = useCallback(() => {
        const elapsed = getElapsedTime();
        return Math.max(0, timeout - elapsed);
    }, [timeout, getElapsedTime]);

    // Handle activity
    const handleActivity = useCallback(() => {
        if (isIdle) {
            onActive?.();
        }
        reset();
    }, [isIdle, onActive, reset]);

    // Set up event listeners
    useEffect(() => {
        eventHandlerRef.current = handleActivity;
        const handler = handleActivity;

        const addEventListeners = () => {
            events.forEach(event => {
                document.addEventListener(event, handler, { passive: true });
            });
        };

        const removeEventListeners = () => {
            events.forEach(event => {
                document.removeEventListener(event, handler);
            });
        };

        if (isRunning) {
            addEventListeners();
            reset();
        }

        return () => {
            removeEventListeners();
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [events, handleActivity, reset, isRunning]);

    return {
        isIdle,
        start,
        stop,
        reset,
        getElapsedTime,
        getRemainingTime,
    };
};