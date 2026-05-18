import React from 'react';
import { centralizedErrorService } from '../services';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactElement;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Simple Error Boundary
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Error caught by boundary:', error, errorInfo);
    
    // Report to centralized error service
    centralizedErrorService.handleError(error, {
      severity: 'high',
      context: {
        component: 'ErrorBoundary',
        errorInfo: errorInfo.componentStack
      }
    });
    
    this.setState({
      hasError: true,
      error
    });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset);
      }

      return (
        <div style={{
          padding: '20px',
          margin: '10px 0',
          backgroundColor: '#fee',
          border: '1px solid #fcc',
          borderRadius: '5px',
          textAlign: 'center'
        }}>
          <h3 style={{ color: '#d33', margin: '0 0 10px 0' }}>⚠️ Error</h3>
          <p style={{ margin: '0 0 15px 0' }}>Something went wrong.</p>
          <button 
            onClick={this.handleReset}
            style={{
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '3px',
              cursor: 'pointer'
            }}
          >
            Try Again
          </button>
          
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details style={{ marginTop: '15px', textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer' }}>Error Details</summary>
              <pre style={{ 
                background: '#f8f9fa', 
                padding: '8px', 
                overflow: 'auto', 
                fontSize: '11px',
                marginTop: '5px'
              }}>
                {this.state.error.toString()}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;