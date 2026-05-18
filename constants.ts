import { InventoryItem, User, ActivityLogEntry, UserRole } from './types';

// This file now only contains mock data for features like Zoho import simulation.
// The main database has been migrated to Firebase Firestore.

export const MOCK_ZOHO_IMPORT: Omit<InventoryItem, 'id' | 'organizationId'>[] = [
    { name: 'Ergonomic Mousepad', sku: 'EMP-01', category: 'Accessories', stock: 75, threshold: 20, supplier: 'ErgoLife', description: 'Gel wrist support mousepad.' },
    { name: '4K HDMI Cable', sku: 'HDMI-4K-02', category: 'Cables', stock: 120, threshold: 30, supplier: 'ConnectAll', description: '6ft high-speed 4K HDMI cable.' },
    { name: 'Blue Light Glasses', sku: 'BLG-03', category: 'Wellness', stock: 40, threshold: 15, supplier: 'VisionClear', description: 'Glasses to reduce eye strain from screens.' },
];
