import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS, API_BASE_URL } from '../utils/apiConfig';
import { auth } from '../services/firebase';

export interface ZohoOrgConfig {
  clientId: string;
  clientSecret: string;
  zohoOrgId: string;
  region: string;
  redirectUri: string;
}

interface ZohoSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  onConfigSaved: () => void;
}

// The redirect URL Zoho sends users back to after auth.
// Derived from API_BASE_URL so it stays in sync across environments.
const DEFAULT_REDIRECT_URL = `${API_BASE_URL.replace(/\/$/, '')}/callback/zoho`;

const REGION_OPTIONS = [
  { value: 'us', label: 'United States (zoho.com)', consoleUrl: 'https://api-console.zoho.com' },
  { value: 'eu', label: 'Europe (zoho.eu)',          consoleUrl: 'https://api-console.zoho.eu' },
  { value: 'in', label: 'India (zoho.in)',            consoleUrl: 'https://api-console.zoho.in' },
  { value: 'au', label: 'Australia (zoho.com.au)',    consoleUrl: 'https://api-console.zoho.com.au' },
  { value: 'jp', label: 'Japan (zoho.jp)',            consoleUrl: 'https://api-console.zoho.jp' },
];

const ZohoSetupModal: React.FC<ZohoSetupModalProps> = ({ isOpen, onClose, orgId, onConfigSaved }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [zohoOrgId, setZohoOrgId] = useState('');
  const [redirectUri, setRedirectUri] = useState(DEFAULT_REDIRECT_URL);
  const [region, setRegion] = useState('us');
  const [copiedUri, setCopiedUri] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // Load existing config on open
  useEffect(() => {
    if (!isOpen || !orgId) return;
    const load = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`${API_ENDPOINTS.zohoConfig}?orgId=${encodeURIComponent(orgId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (data.configured && data.config) {
            setClientId(data.config.clientId || '');
            setZohoOrgId(data.config.zohoOrgId || '');
            setRegion(data.config.region || 'us');
            // Replace any saved localhost URL with the current production URL
            const savedUri = data.config.redirectUri || DEFAULT_REDIRECT_URL;
            setRedirectUri(savedUri.includes('localhost') ? DEFAULT_REDIRECT_URL : savedUri);
            // Never pre-fill the secret for security — user must re-enter to change
          }
        }
      } catch {
        // Silent — just start with empty fields
      }
    };
    load();
  }, [isOpen, orgId]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!clientId.trim()) { setError('Client ID is required'); return; }
    if (!clientSecret.trim()) { setError('Client Secret is required'); return; }
    if (!zohoOrgId.trim()) { setError('Zoho Books Organization ID is required'); return; }
    if (!redirectUri.trim()) { setError('Redirect URL is required'); return; }

    setIsSaving(true);
    setError('');

    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(API_ENDPOINTS.zohoConfig, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          orgId,
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          zohoOrgId: zohoOrgId.trim(),
          redirectUri: redirectUri.trim(),
          region,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || `Server error ${res.status}`);
      }

      onConfigSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save Zoho configuration');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Configure Zoho Books</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Region-specific console link — shown before fields so user can open the right console first */}
        {(() => {
          const regionOption = REGION_OPTIONS.find(r => r.value === region);
          return regionOption ? (
            <div className="mb-5 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg">
              <p className="text-sm text-indigo-800 dark:text-indigo-300">
                Your region is <strong>{regionOption.label}</strong>. Get your credentials from the{' '}
                <a
                  href={regionOption.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-semibold hover:no-underline"
                >
                  {regionOption.consoleUrl.replace('https://', '')}
                </a>
                {' '}→ <strong>Server-based Applications</strong>.
              </p>
            </div>
          ) : null;
        })()}

        <div className="space-y-4">
          {/* Region */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Region <span className="text-red-500">*</span>
            </label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {REGION_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Select the region where your Zoho account is registered.
            </p>
          </div>

          {/* Client ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Client ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              placeholder="1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Found under your registered app in the Zoho API Console.
            </p>
          </div>

          {/* Client Secret */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Client Secret <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="new-password"
                placeholder="Enter your Client Secret"
                className="w-full px-3 py-2 pr-10 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                tabIndex={-1}
              >
                {showSecret ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Click the eye icon to verify. Must match exactly what's in your Zoho Developer Console.
            </p>
          </div>

          {/* Zoho Org ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Zoho Books Organization ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={zohoOrgId}
              onChange={(e) => setZohoOrgId(e.target.value)}
              placeholder="e.g. 12345678"
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              In Zoho Books: Settings → Organization Profile → Organization ID (numeric).
            </p>
          </div>

          {/* Redirect URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Authorized Redirect URL
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={redirectUri}
                readOnly
                className="flex-1 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono text-sm select-all cursor-text"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(redirectUri).then(() => {
                    setCopiedUri(true);
                    setTimeout(() => setCopiedUri(false), 2000);
                  });
                }}
                className="shrink-0 px-3 py-2 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                {copiedUri ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-md">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                <strong>Required:</strong> This URL must be added to your Zoho app's{' '}
                <strong>Authorized Redirect URLs</strong> in the developer console above.
                An exact mismatch causes the <code>invalid_code</code> error.
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-wait transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save & Connect to Zoho'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ZohoSetupModal;
