/**
 * Development Logger Utility
 * Prevents console pollution in production while preserving development debugging
 */

const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';

interface LoggerOptions {
  prefix?: string;
  color?: string;
}

class Logger {
  private enabled: boolean;

  constructor() {
    this.enabled = isDevelopment;
  }

  private formatMessage(prefix: string, message: string, ...args: any[]): void {
    if (!this.enabled) return;
    console.log(`${prefix}${message}`, ...args);
  }

  log(message: string, ...args: any[]): void {
    if (!this.enabled) return;
    console.log(message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.formatMessage('ℹ️ ', message, ...args);
  }

  success(message: string, ...args: any[]): void {
    this.formatMessage('✅ ', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    // Warnings always show
    console.warn(`⚠️ ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    // Errors always show
    console.error(`❌ ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (!this.enabled) return;
    console.debug(`🔍 ${message}`, ...args);
  }

  group(label: string): void {
    if (!this.enabled) return;
    console.group(label);
  }

  groupEnd(): void {
    if (!this.enabled) return;
    console.groupEnd();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export const logger = new Logger();

// Convenience exports
export const log = logger.log.bind(logger);
export const info = logger.info.bind(logger);
export const success = logger.success.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const debug = logger.debug.bind(logger);

export default logger;
