/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_DATABASE_URL: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_FIREBASE_MEASUREMENT_ID: string
  readonly VITE_ZOHO_ACCOUNTS_URL: string
  readonly VITE_ZOHO_BOOKS_API_URL: string
  readonly GEMINI_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Global type declarations
declare global {
  interface Window {
    gtag?: (command: 'config' | 'event' | 'exception', targetId: string, config?: Record<string, any>) => void;
  }
  
  function gtag(command: 'config' | 'event' | 'exception', targetId: string, config?: Record<string, any>): void;
}