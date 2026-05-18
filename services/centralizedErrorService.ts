/**
 * Centralized Error Handling Service
 * 
 * Provides comprehensive error handling, logging, and recovery mechanisms
 * across the entire application
 */

import { firestoreService } from './firestoreService';

export interface ErrorInfo {
  error: Error;
  errorInfo?: {
    componentStack?: string;
    errorBoundary?: string;
  };
  context?: {
    userId?: string;
    organizationId?: string;
    action?: string;
    component?: string;
    props?: any;
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  sessionId: string;
}

export interface ErrorPattern {
  pattern: RegExp;
  handler: (error: Error, context?: any) => Promise<void> | void;
  recovery?: () => Promise<void> | void;
  description: string;
}

class CentralizedErrorService {
  private static instance: CentralizedErrorService;
  private errorPatterns: ErrorPattern[] = [];
  private sessionId: string;
  private errorCounts = new Map<string, number>();
  private lastErrorTime = new Map<string, number>();
  private readonly ERROR_THROTTLE_TIME = 5000; // 5 seconds

  constructor() {
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.initializeErrorPatterns();
    this.setupGlobalErrorHandlers();
  }

  static getInstance(): CentralizedErrorService {
    if (!CentralizedErrorService.instance) {
      CentralizedErrorService.instance = new CentralizedErrorService();
    }
    return CentralizedErrorService.instance;
  }

  /**
   * Initialize common error patterns and their handlers
   */
  private initializeErrorPatterns(): void {
    this.errorPatterns = [
      {
        pattern: /firebase.*permission-denied/i,
        handler: this.handlePermissionError,
        recovery: this.recoverPermissionError,
        description: 'Firebase permission denied'
      },
      {
        pattern: /network.*failed|fetch.*failed/i,
        handler: this.handleNetworkError,
        recovery: this.recoverNetworkError,
        description: 'Network connectivity issues'
      },
      {
        pattern: /quota.*exceeded|too many requests/i,
        handler: this.handleQuotaError,
        recovery: this.recoverQuotaError,
        description: 'API quota or rate limit exceeded'
      },
      {
        pattern: /document.*not.*found|item.*not.*found/i,
        handler: this.handleNotFoundError,
        recovery: this.recoverNotFoundError,
        description: 'Document or item not found'
      },
      {
        pattern: /timeout|timed.*out/i,
        handler: this.handleTimeoutError,
        recovery: this.recoverTimeoutError,
        description: 'Operation timeout'
      },
      {
        pattern: /insufficient.*permissions|unauthorized/i,
        handler: this.handleAuthError,
        recovery: this.recoverAuthError,
        description: 'Authentication or authorization error'
      }
    ];
  }

  /**
   * Setup global error handlers
   */
  private setupGlobalErrorHandlers(): void {
    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError(event.reason, {
        severity: 'high',
        context: {
          action: 'unhandled_promise_rejection',
          component: 'global'
        }
      });
    });

    // Handle uncaught errors
    window.addEventListener('error', (event) => {
      this.handleError(event.error || new Error(event.message), {
        severity: 'critical',
        context: {
          action: 'uncaught_error',
          component: 'global',
          props: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
          }
        }
      });
    });
  }

  /**
   * Main error handling method
   */
  async handleError(
    error: Error,
    options: {
      severity?: 'low' | 'medium' | 'high' | 'critical';
      context?: any;
      shouldLog?: boolean;
      shouldNotify?: boolean;
      shouldRecover?: boolean;
    } = {}
  ): Promise<void> {
    const {
      severity = 'medium',
      context,
      shouldLog = true,
      shouldNotify = severity === 'high' || severity === 'critical',
      shouldRecover = true
    } = options;

    const errorKey = `${error.name}_${error.message}`;
    const now = Date.now();

    // Throttle duplicate errors
    const lastTime = this.lastErrorTime.get(errorKey) || 0;
    if (now - lastTime < this.ERROR_THROTTLE_TIME) {
      this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
      return;
    }

    this.lastErrorTime.set(errorKey, now);
    const count = this.errorCounts.get(errorKey) || 1;
    this.errorCounts.set(errorKey, count);

    const errorInfo: ErrorInfo = {
      error,
      context,
      severity,
      timestamp: now,
      sessionId: this.sessionId
    };

    try {
      // Log error
      if (shouldLog) {
        await this.logError(errorInfo, count);
      }

      // Find and execute pattern handler
      if (shouldRecover) {
        await this.executePatternHandler(error, context);
      }

      // Send notifications for high-severity errors
      if (shouldNotify) {
        await this.notifyError(errorInfo, count);
      }

      // Report to external services (analytics, crash reporting)
      await this.reportError(errorInfo, count);

    } catch (handlingError) {
      console.error('❌ Error in error handler:', handlingError);
    }
  }

  /**
   * Log error to Firestore with organization context
   */
  private async logError(errorInfo: ErrorInfo, count: number): Promise<void> {
    try {
      const organizationId = errorInfo.context?.organizationId;
      
      if (organizationId) {
        await firestoreService.createActivityLog(organizationId, {
          action: 'error',
          target: 'system',
          user: errorInfo.context?.userId || 'system',
          userName: 'System',
          description: `Error: ${errorInfo.error.message} (${count}x)`,
          metadata: {
            errorName: errorInfo.error.name,
            errorMessage: errorInfo.error.message,
            errorStack: errorInfo.error.stack,
            severity: errorInfo.severity,
            context: errorInfo.context,
            sessionId: errorInfo.sessionId,
            count
          }
        });
      }

      // Also log to console with structured format
      const logMethod = errorInfo.severity === 'critical' ? console.error : 
                       errorInfo.severity === 'high' ? console.warn : console.log;
      
      logMethod(`🔥 Error [${errorInfo.severity}]:`, {
        message: errorInfo.error.message,
        stack: errorInfo.error.stack,
        context: errorInfo.context,
        count
      });

    } catch (error) {
      console.error('Failed to log error:', error);
    }
  }

  /**
   * Execute pattern-specific error handler
   */
  private async executePatternHandler(error: Error, context?: any): Promise<void> {
    const errorMessage = error.message || error.toString();
    
    for (const pattern of this.errorPatterns) {
      if (pattern.pattern.test(errorMessage)) {
        try {
          await pattern.handler.call(this, error, context);
          if (pattern.recovery) {
            await pattern.recovery.call(this);
          }
          break;
        } catch (handlerError) {
          console.error(`Handler failed for pattern ${pattern.description}:`, handlerError);
        }
      }
    }
  }

  /**
   * Notify users about critical errors
   */
  private async notifyError(errorInfo: ErrorInfo, count: number): Promise<void> {
    try {
      const { organizationId, userId } = errorInfo.context || {};
      
      if (organizationId && userId) {
        await firestoreService.createNotification(organizationId, {
          userId,
          type: 'error_alert',
          title: `System Error (${errorInfo.severity})`,
          message: `An error occurred: ${errorInfo.error.message}`,
          data: {
            severity: errorInfo.severity,
            errorName: errorInfo.error.name,
            count,
            sessionId: errorInfo.sessionId
          }
        } as any);
      }
    } catch (error) {
      console.error('Failed to create error notification:', error);
    }
  }

  /**
   * Report error to external services
   */
  private async reportError(errorInfo: ErrorInfo, count: number): Promise<void> {
    // Integrate with crash reporting services (Sentry, Bugsnag, etc.)
    if ((window as any).gtag && errorInfo.severity === 'critical') {
      (window as any).gtag('event', 'exception', {
        description: errorInfo.error.message,
        fatal: true
      });
    }
  }

  // ==========================================================================
  // SPECIFIC ERROR HANDLERS
  // ==========================================================================

  private async handlePermissionError(error: Error, context?: any): Promise<void> {
    console.warn('🔒 Permission denied - user may need elevated access');
  }

  private async recoverPermissionError(): Promise<void> {
    // Could trigger auth refresh or role check
    window.dispatchEvent(new CustomEvent('auth:refresh-needed'));
  }

  private async handleNetworkError(error: Error, context?: any): Promise<void> {
    console.warn('🌐 Network error detected - attempting recovery');
  }

  private async recoverNetworkError(): Promise<void> {
    // Could retry failed requests or enable offline mode
    window.dispatchEvent(new CustomEvent('network:retry-needed'));
  }

  private async handleQuotaError(error: Error, context?: any): Promise<void> {
    console.warn('📊 Quota exceeded - implementing backoff strategy');
  }

  private async recoverQuotaError(): Promise<void> {
    // Could implement exponential backoff
    window.dispatchEvent(new CustomEvent('quota:backoff-needed'));
  }

  private async handleNotFoundError(error: Error, context?: any): Promise<void> {
    console.warn('🔍 Resource not found - may need refresh');
  }

  private async recoverNotFoundError(): Promise<void> {
    // Could trigger data refresh
    window.dispatchEvent(new CustomEvent('data:refresh-needed'));
  }

  private async handleTimeoutError(error: Error, context?: any): Promise<void> {
    console.warn('⏱️ Operation timeout - may retry with longer timeout');
  }

  private async recoverTimeoutError(): Promise<void> {
    // Could retry with exponential backoff
    window.dispatchEvent(new CustomEvent('timeout:retry-needed'));
  }

  private async handleAuthError(error: Error, context?: any): Promise<void> {
    console.warn('🔐 Authentication error - may need re-login');
  }

  private async recoverAuthError(): Promise<void> {
    // Could trigger re-authentication flow
    window.dispatchEvent(new CustomEvent('auth:reauth-needed'));
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Register custom error pattern
   */
  registerErrorPattern(pattern: ErrorPattern): void {
    this.errorPatterns.push(pattern);
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    sessionId: string;
    totalErrors: number;
    errorCounts: Map<string, number>;
    lastErrorTimes: Map<string, number>;
  } {
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
    
    return {
      sessionId: this.sessionId,
      totalErrors,
      errorCounts: new Map(this.errorCounts),
      lastErrorTimes: new Map(this.lastErrorTime)
    };
  }

  /**
   * Clear error statistics
   */
  clearStats(): void {
    this.errorCounts.clear();
    this.lastErrorTime.clear();
  }

  /**
   * Create user-friendly error message
   */
  createUserMessage(error: Error): string {
    const errorMessage = error.message || error.toString();
    
    if (/permission.*denied/i.test(errorMessage)) {
      return 'You don\'t have permission to perform this action. Please contact your administrator.';
    }
    
    if (/network.*failed/i.test(errorMessage)) {
      return 'Unable to connect to the server. Please check your internet connection and try again.';
    }
    
    if (/quota.*exceeded/i.test(errorMessage)) {
      return 'Service temporarily unavailable due to high usage. Please try again in a few minutes.';
    }
    
    if (/not.*found/i.test(errorMessage)) {
      return 'The requested item could not be found. It may have been deleted or moved.';
    }
    
    if (/timeout/i.test(errorMessage)) {
      return 'The operation took too long to complete. Please try again.';
    }
    
    return 'An unexpected error occurred. Please try again or contact support if the problem persists.';
  }
}

export const centralizedErrorService = CentralizedErrorService.getInstance();
export default centralizedErrorService;