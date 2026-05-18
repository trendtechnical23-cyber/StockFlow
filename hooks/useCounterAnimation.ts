import { useState, useEffect } from 'react';

interface UseCounterAnimationOptions {
  start?: number;
  end: number;
  duration?: number;
  delay?: number;
}

export const useCounterAnimation = ({ 
  start = 0, 
  end, 
  duration = 2000, 
  delay = 0 
}: UseCounterAnimationOptions) => {
  const [count, setCount] = useState(start);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (end === start) {
      setCount(end);
      return;
    }

    const startAnimation = () => {
      setIsAnimating(true);
      const startTime = Date.now();
      const startValue = start;
      const endValue = end;
      const range = endValue - startValue;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function for smooth animation (ease-out)
        const easeOut = 1 - Math.pow(1 - progress, 3);
        
        const currentValue = Math.round(startValue + (range * easeOut));
        setCount(currentValue);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setIsAnimating(false);
        }
      };

      requestAnimationFrame(animate);
    };

    // Start animation after delay
    const timer = setTimeout(startAnimation, delay);

    return () => {
      clearTimeout(timer);
      setIsAnimating(false);
    };
  }, [start, end, duration, delay]);

  return { count, isAnimating };
};

export default useCounterAnimation;