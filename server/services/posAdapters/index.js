/**
 * POS Adapter Registry
 * Maps provider names to their adapter classes.
 * To add a new POS system, create an adapter extending BasePosAdapter
 * and register it here.
 */

const OdooAdapter = require('./odooAdapter');

const adapters = {
  odoo: OdooAdapter,
  // square: require('./squareAdapter'),
  // shopify: require('./shopifyAdapter'),
};

/**
 * Get the adapter class for a given provider name.
 * @param {string} provider - e.g. 'odoo'
 * @returns {typeof import('./basePosAdapter')}
 */
function getAdapterClass(provider) {
  const AdapterClass = adapters[provider];
  if (!AdapterClass) {
    throw new Error(`Unsupported POS provider: "${provider}". Supported: ${Object.keys(adapters).join(', ')}`);
  }
  return AdapterClass;
}

/**
 * Create an adapter instance with the given config.
 * @param {string} provider
 * @param {object} config - { baseUrl, apiKey, database?, ... }
 * @returns {import('./basePosAdapter')}
 */
function createAdapter(provider, config) {
  const AdapterClass = getAdapterClass(provider);
  return new AdapterClass(config);
}

/** List all supported provider names */
function listProviders() {
  return Object.keys(adapters);
}

module.exports = { getAdapterClass, createAdapter, listProviders };
