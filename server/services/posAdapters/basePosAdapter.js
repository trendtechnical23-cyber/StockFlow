/**
 * Base POS Adapter - Abstract interface for POS system integrations
 * All POS adapters (Odoo, Square, Shopify, etc.) must extend this class.
 */

class BasePosAdapter {
  constructor(config) {
    if (new.target === BasePosAdapter) {
      throw new Error('BasePosAdapter is abstract and cannot be instantiated directly');
    }
    this.config = config;
  }

  /** @returns {string} Provider identifier (e.g. 'odoo', 'square') */
  get provider() {
    throw new Error('provider getter must be implemented');
  }

  /**
   * Test whether the stored credentials are valid.
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented');
  }

  /**
   * Fetch products/inventory from the POS system.
   * @param {object} options - { page, limit, search }
   * @returns {Promise<{items: object[], total: number, hasMore: boolean}>}
   */
  async fetchProducts(options = {}) {
    throw new Error('fetchProducts() must be implemented');
  }

  /**
   * Fetch a single product by its POS-side ID.
   * @param {string} productId
   * @returns {Promise<object>}
   */
  async getProduct(productId) {
    throw new Error('getProduct() must be implemented');
  }

  /**
   * Normalize a raw POS product into the StockFlow InventoryItem shape.
   * @param {object} posItem - Raw item from the POS API
   * @returns {object} Normalized item ready for Firestore
   */
  mapToInventoryItem(posItem) {
    throw new Error('mapToInventoryItem() must be implemented');
  }

  /**
   * Return a list of fields the adapter can import, for UI display.
   * @returns {string[]}
   */
  getSupportedFields() {
    return ['name', 'sku', 'quantity', 'price', 'cost', 'category'];
  }

  // ------- Write-back interface (bidirectional sync) -------

  /**
   * Adjust the on-hand quantity of an existing product in the POS system.
   * For Odoo this uses stock.quant + action_apply_inventory.
   * @param {string|number} productId  POS-side product ID
   * @param {number}        newQuantity  New on-hand quantity
   * @param {string}        [reason]     Human-readable reason for the adjustment
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async adjustInventory(productId, newQuantity, reason = 'StockFlow adjustment') {
    throw new Error('adjustInventory() must be implemented by the adapter');
  }

  /**
   * Create a new product in the POS system.
   * @param {object} productData  Fields matching InventoryItem shape
   * @returns {Promise<{posId: string}>}  The newly created product's POS ID
   */
  async createProduct(productData) {
    throw new Error('createProduct() must be implemented by the adapter');
  }

  /**
   * Update an existing product's metadata (name, price, SKU, etc.) in the POS.
   * Does NOT change stock — use adjustInventory() for that.
   * @param {string|number} productId
   * @param {object}        productData  Partial InventoryItem fields to update
   * @returns {Promise<void>}
   */
  async updateProduct(productId, productData) {
    throw new Error('updateProduct() must be implemented by the adapter');
  }

  /**
   * Archive / soft-delete a product in the POS system.
   * Most POS systems prefer archiving over hard deletion.
   * @param {string|number} productId
   * @returns {Promise<void>}
   */
  async deleteProduct(productId) {
    throw new Error('deleteProduct() must be implemented by the adapter');
  }
}

module.exports = BasePosAdapter;
