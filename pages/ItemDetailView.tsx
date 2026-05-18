import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { InventoryItem, View } from '../types';
import ItemDetailsModal from '../components/ItemDetailsModal';
import ConfirmationModal from '../components/ConfirmationModal';

const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const DeleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
const BackIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;

const DetailCard: React.FC<{title: string; value: string | number; className?: string;}> = ({ title, value, className }) => (
    <div className={className}>
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</h3>
        <p className="mt-1 text-lg text-gray-900 dark:text-gray-100">{value}</p>
    </div>
);

const StockProgressBar: React.FC<{stock: number; threshold: number}> = ({ stock, threshold }) => {
    const max = Math.max(stock, threshold) * 1.2;
    const percentage = (stock / max) * 100;
    const thresholdPercentage = (threshold / max) * 100;
    const isLowStock = stock <= threshold;

    return (
        <div>
            <div className="flex justify-between mb-1">
                <span className="text-base font-medium text-gray-700 dark:text-gray-300">Stock Level</span>
                <span className={`text-sm font-medium ${isLowStock ? 'text-red-500' : 'text-green-500'}`}>
                    {stock} Units
                </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4 dark:bg-gray-700 relative">
                <div 
                    className={`h-4 rounded-full ${isLowStock ? 'bg-red-600' : 'bg-green-600'}`}
                    style={{ width: `${percentage}%` }}
                ></div>
                <div 
                    className="absolute top-0 h-4 border-r-2 border-dashed border-gray-500 dark:border-gray-400"
                    style={{ left: `${thresholdPercentage}%` }}
                    title={`Threshold: ${threshold}`}
                ></div>
            </div>
             <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Threshold is {threshold} units.</p>
        </div>
    );
};


const ItemDetailView: React.FC = () => {
    const { state, selectItem, goBack, previousView, handleUpdateItem, handleDeleteItem } = useAppContext();
    const { inventory, selectedItemId } = state;

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    
    const getViewName = (view: View): string => {
        switch (view) {
            case View.Dashboard: return 'Dashboard';
            case View.Inventory: return 'Inventory';
            case View.Reports: return 'Reports';
            case View.Activity: return 'Activity';
            case View.Settings: return 'Settings';
            case View.StockTake: return 'Stock Take';
            case View.Billing: return 'Billing';
            case View.Integrations: return 'Integrations';
            default: return 'Dashboard';
        }
    };
    
    const item = inventory.find(i => i.id === selectedItemId);

    if (!item) {
        return (
            <div className="text-center p-8">
                <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Item not found</h2>
                <p className="text-gray-500 dark:text-gray-400">This item may have been deleted.</p>
                <button onClick={goBack} className="mt-4 flex items-center gap-2 mx-auto px-4 py-2 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 transition-colors">
                    <BackIcon /> Back to {getViewName(previousView)}
                </button>
            </div>
        );
    }
    
    const handleSave = async (itemData: Omit<InventoryItem, 'id'> | InventoryItem) => {
        await handleUpdateItem(itemData as InventoryItem);
        setIsEditModalOpen(false);
    };
    
    const handleConfirmDelete = async () => {
        setIsDeleting(true);
        await handleDeleteItem(item.id);
        setIsDeleting(false);
        setIsConfirmOpen(false);
        goBack(); // Navigate back to previous view
    };
    
    return (
        <div className="max-w-4xl mx-auto">
             <div className="flex items-center justify-between mb-6">
                <button onClick={goBack} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                    <BackIcon /> Back to {getViewName(previousView)}
                </button>
                <div className="flex items-center gap-4">
                    <button onClick={() => setIsEditModalOpen(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors">
                        <EditIcon /> Edit
                    </button>
                    <button onClick={() => setIsConfirmOpen(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors">
                       <DeleteIcon /> Delete
                    </button>
                </div>
            </div>
            
            <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg">
                 <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{item.description || item.name}</h1>
                 <p className="text-sm font-mono text-gray-500 dark:text-gray-400 mt-1">SKU: {item.sku}</p>
                 
                 <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <DetailCard title="Category" value={item.category} />
                        <DetailCard title="Supplier" value={item.supplier} />
                        <DetailCard title="Unit" value={item.unit || 'each'} />
                    </div>
                 </div>

                 <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-6">
                    <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-200">Pricing Information</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <DetailCard 
                            title="Cost Price" 
                            value={item.cost ? `R${item.cost.toFixed(2)}` : 'Not set'} 
                            className={!item.cost ? 'text-gray-400 dark:text-gray-500' : ''} 
                        />
                        <DetailCard 
                            title="Selling Price" 
                            value={item.price ? `R${item.price.toFixed(2)}` : 'Not set'} 
                            className={!item.price ? 'text-gray-400 dark:text-gray-500' : ''} 
                        />
                        <DetailCard 
                            title="Profit Margin" 
                            value={item.cost && item.price ? `R${(item.price - item.cost).toFixed(2)}` : 'N/A'} 
                            className={!item.cost || !item.price ? 'text-gray-400 dark:text-gray-500' : item.price > item.cost ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} 
                        />
                        <DetailCard 
                            title="Stock Value" 
                            value={item.cost ? `R${(item.cost * item.stock).toFixed(2)}` : 'N/A'} 
                            className={!item.cost ? 'text-gray-400 dark:text-gray-500' : 'text-indigo-600 dark:text-indigo-400'} 
                        />
                    </div>
                 </div>

                 <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-6">
                    <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-200">Stock Information</h2>
                    <StockProgressBar stock={item.stock} threshold={item.threshold} />
                 </div>

                 <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-6">
                     <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-200">Description</h2>
                     <p className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{item.description || 'No description provided.'}</p>
                 </div>
            </div>
            
            {isEditModalOpen && <ItemDetailsModal item={item} onClose={() => setIsEditModalOpen(false)} onSave={handleSave} onDelete={async () => setIsConfirmOpen(true)} />}
            
            <ConfirmationModal
                isOpen={isConfirmOpen}
                onClose={() => setIsConfirmOpen(false)}
                onConfirm={handleConfirmDelete}
                title="Confirm Deletion"
                message={`Are you sure you want to delete the item "${item.description || item.name}"? This action cannot be undone.`}
                confirmText="Delete"
                isConfirming={isDeleting}
            />

        </div>
    );
};

export default ItemDetailView;