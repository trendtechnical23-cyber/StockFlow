import { useState, useEffect } from 'react';

const formatDuration = (seconds: number): string => {
    if (seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const pad = (num: number) => num.toString().padStart(2, '0');

    return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

export const useLiveTimer = (startTime: number | Date | null | undefined): string => {
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    useEffect(() => {
        if (!startTime) {
            setElapsedSeconds(0);
            return;
        }

        const startTimestamp = typeof startTime === 'number' ? startTime : new Date(startTime).getTime();

        const intervalId = setInterval(() => {
            const now = Date.now();
            const duration = Math.floor((now - startTimestamp) / 1000);
            setElapsedSeconds(duration);
        }, 1000);

        // Set initial value immediately
        const initialDuration = Math.floor((Date.now() - startTimestamp) / 1000);
        setElapsedSeconds(initialDuration);


        return () => clearInterval(intervalId);
    }, [startTime]);

    return formatDuration(elapsedSeconds);
};
