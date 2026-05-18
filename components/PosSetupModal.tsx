import React, { useState, useEffect } from 'react';
import { PosService } from '../services/posService';
import type { PosProvider } from '../types';

interface PosSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  onConnected: () => void;
}

const PosSetupModal: React.FC<PosSetupModalProps> = ({ isOpen, onClose, orgId, onConnected }) => {
  const [provider, setProvider] = useState<PosProvider>('odoo');
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [database, setDatabase] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (isOpen) {
      PosService.getProviders()
        .then(setProviders)
        .catch(() => setProviders([{ id: 'odoo', name: 'Odoo' }]));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setError('');
    try {
      const result = await PosService.connect({
        orgId,
        provider,
        baseUrl: baseUrl.trim(),
        username: username.trim() || undefined,
        apiKey: apiKey.trim(),
        database: database.trim() || undefined,
      });
      setTestResult(result);
      if (result.success) {
        // Connection was saved during test
        onConnected();
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setIsTesting(false);
    }
  };

  const handleConnect = async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setError('Base URL and API Key are required');
      return;
    }
    if (provider === 'odoo' && !username.trim()) {
      setError('Username (email) is required for Odoo');
      return;
    }
    setIsConnecting(true);
    setError('');
    try {
      const result = await PosService.connect({
        orgId,
        provider,
        baseUrl: baseUrl.trim(),
        username: username.trim() || undefined,
        apiKey: apiKey.trim(),
        database: database.trim() || undefined,
      });
      if (result.success) {
        onConnected();
        onClose();
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const providerHints: Record<string, { urlPlaceholder: string; urlHelp: string; showDb: boolean; showUsername: boolean }> = {
    odoo: {
      urlPlaceholder: 'https://mycompany.odoo.com',
      urlHelp: 'Your Odoo instance URL (e.g. https://mycompany.odoo.com)',
      showDb: true,
      showUsername: true,
    },
  };

  const hints = providerHints[provider] || {
    urlPlaceholder: 'https://api.example.com',
    urlHelp: 'The base URL of your POS API',
    showDb: false,
    showUsername: false,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Connect POS System</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              POS Provider
            </label>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as PosProvider);
                setTestResult(null);
                setError('');
              }}
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Base URL
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={hints.urlPlaceholder}
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hints.urlHelp}</p>
          </div>

          {/* Username (shown for providers that need it, e.g. Odoo) */}
          {hints.showUsername && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Username / Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="you@yourcompany.com"
                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                The login e-mail of the Odoo user who generated the API key
              </p>
            </div>
          )}

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {provider === 'odoo'
                ? 'Generate an API key in Odoo: Settings → Users → API Keys'
                : 'Your POS system API key'}
            </p>
          </div>

          {/* Database (conditional) */}
          {hints.showDb && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Database Name <span className="text-gray-400">(optional)</span>
              </label>
              <input
                type="text"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="e.g. mycompany"
                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Required only for multi-database Odoo setups
              </p>
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div
              className={`p-3 rounded-md text-sm ${
                testResult.success
                  ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                  : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300'
              }`}
            >
              {testResult.success ? '✅ ' : '❌ '}
              {testResult.message}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-md text-sm bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleTestConnection}
            disabled={isTesting || !baseUrl.trim() || !apiKey.trim() || (hints.showUsername && !username.trim())}
            className="px-4 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isTesting ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            onClick={handleConnect}
            disabled={isConnecting || !baseUrl.trim() || !apiKey.trim() || (hints.showUsername && !username.trim())}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isConnecting ? 'Connecting...' : 'Connect & Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PosSetupModal;
