import React, { useMemo, useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { calculateTotalValue } from '../utils/inventoryUtils';

// Colors for charts
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF7C7C'];
import { fetchStockMovementData } from '../services/apiService';
import { ActivityLogEntry } from '../types';

interface ChartData {
    [key: string]: string | number;
}

const ReportsView: React.FC = () => {
    const { state } = useAppContext();
    const { inventory, currentOrganization } = state;

    // State for filters
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [dateRange, setDateRange] = useState({
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
    });
    const [movementData, setMovementData] = useState<ActivityLogEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadMovementData = async () => {
            if (!currentOrganization?.id) return;
            
            setIsLoading(true);
            try {
                const data = await fetchStockMovementData();
                setMovementData(data || []);
            } catch (error) {
                console.error('Error loading movement data:', error);
                setMovementData([]);
            } finally {
                setIsLoading(false);
            }
        };
        loadMovementData();
    }, [currentOrganization?.id]);

    const categories = useMemo(() => {
        const categorySet = new Set(inventory.map(item => item.category).filter(Boolean));
        return ['All', ...Array.from(categorySet)];
    }, [inventory]);

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setDateRange(prev => ({...prev, [e.target.name]: e.target.value }));
    }

    const filteredLogs = useMemo(() => {
        if (!dateRange.start || !dateRange.end) return movementData;
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        endDate.setHours(23, 59, 59, 999); // Include the whole end day

        return movementData.filter(log => {
            const logDate = new Date(log.timestamp);
            return logDate >= startDate && logDate <= endDate;
        });
    }, [movementData, dateRange]);


    const filteredInventory = useMemo(() => {
        if (selectedCategory === 'All') return inventory;
        return inventory.filter(item => item.category === selectedCategory);
    }, [inventory, selectedCategory]);

    const stockStatusDistribution = useMemo(() => {
        if (!inventory || inventory.length === 0) return [];
        
        let healthy = 0;
        let lowStock = 0;
        let outOfStock = 0;
        let overStock = 0;
        
        inventory.forEach(item => {
            if (typeof item.stock === 'number' && typeof item.threshold === 'number') {
                if (item.stock === 0) {
                    outOfStock++;
                } else if (item.stock <= item.threshold) {
                    lowStock++;
                } else if (item.stock > item.threshold * 3) {
                    overStock++;
                } else {
                    healthy++;
                }
            }
        });
        
        return [
            { name: 'Healthy Stock', value: healthy },
            { name: 'Low Stock', value: lowStock },
            { name: 'Out of Stock', value: outOfStock },
            { name: 'Over Stock', value: overStock }
        ].filter(item => item.value > 0);
    }, [inventory]);
    
    const topMostStocked = useMemo(() => {
        if (!filteredInventory || filteredInventory.length === 0) return [];
        
        return [...filteredInventory]
            .filter(item => typeof item.stock === 'number')
            .sort((a,b) => b.stock - a.stock)
            .slice(0, 5);
    }, [filteredInventory]);

    const mostUsedItems = useMemo(() => {
        const usageMap = new Map<string, number>();
        filteredLogs.forEach(log => {
            if (typeof log.details === 'object' && log.details?.change && log.details.itemName) {
                const { from, to } = log.details.change;
                if (from > to) { // It was used/removed
                    const usedAmount = from - to;
                    usageMap.set(log.details.itemName, (usageMap.get(log.details.itemName) || 0) + usedAmount);
                }
            }
        });
        return Array.from(usageMap.entries())
            .map(([name, used]) => ({ name, used }))
            .sort((a, b) => b.used - a.used)
            .slice(0, 10);
    }, [filteredLogs]);

    const recentStockMovement = useMemo(() => {
        const dailyChanges: { [date: string]: ChartData } = {};
        const top5MostActiveItems = [...new Set(
            filteredLogs
                .map(l => typeof l.details === 'object' ? l.details?.itemName : null)
                .filter(Boolean)
        )]
            .slice(0, 5);

        filteredLogs.forEach(log => {
            const date = new Date(log.timestamp).toISOString().split('T')[0];
            if (!dailyChanges[date]) {
                dailyChanges[date] = { date };
            }
            if (typeof log.details === 'object' && log.details?.change && log.details.itemName && top5MostActiveItems.includes(log.details.itemName)) {
                const { from, to } = log.details.change;
                const change = to - from;
                const currentChange = (dailyChanges[date][log.details.itemName] as number) || 0;
                dailyChanges[date][log.details.itemName] = currentChange + change;
            }
        });
        
        const sortedData = Object.values(dailyChanges).sort((a, b) => (a.date as string).localeCompare(b.date as string));
        
        // If no data, create sample structure to prevent chart errors
        if (sortedData.length === 0) {
            const today = new Date().toISOString().split('T')[0];
            return [{ date: today }];
        }
        
        return sortedData;
    }, [filteredLogs]);


    const ChartTooltip = ({ active, payload, label }: any) => {
      if (active && payload && payload.length) {
        return (
          <div className="p-2 bg-gray-700/80 backdrop-blur-sm border border-gray-600 rounded-md text-white">
            <p className="label font-bold">{`${label || ''}`}</p>
            {payload.map((pld: any, index: number) => (
                <p key={pld.dataKey || index} style={{color: pld.fill || pld.stroke}}>
                    {`${pld.name || 'Value'}: ${typeof pld.value === 'number' ? pld.value.toLocaleString() : pld.value || 'N/A'}`}
                </p>
            ))}
          </div>
        );
      }
      return null;
    };
    
    const renderChart = (title: string, children: React.ReactNode, data: any[]) => (
         <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-200">{title}</h2>
             {isLoading ? (
                <div className="flex justify-center items-center h-[300px]">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    <span className="ml-2 text-gray-600 dark:text-gray-400">Loading chart data...</span>
                </div>
             ) : !data || data.length === 0 ? (
                <div className="flex justify-center items-center h-[300px] text-gray-500 dark:text-gray-400">
                    <div className="text-center">
                        <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        <p>No data available for this period</p>
                        <p className="text-sm mt-1">Try adjusting your date range or adding inventory items</p>
                    </div>
                </div>
             ) : (
                <ResponsiveContainer width="100%" height={300}>{children}</ResponsiveContainer>
             )}
        </div>
    );

    // Pricing Analytics
    const pricingAnalytics = useMemo(() => {
        const itemsWithPricing = filteredInventory.filter(item => item.cost && item.price);
        const totalInventoryValue = calculateTotalValue(filteredInventory);
        
        const profitMargins = itemsWithPricing.map(item => ({
            name: item.name,
            sku: item.sku,
            cost: item.cost!,
            price: item.price!,
            margin: item.price! - item.cost!,
            marginPercent: ((item.price! - item.cost!) / item.cost!) * 100,
            stock: item.stock,
            stockValue: item.cost! * item.stock
        })).sort((a, b) => b.marginPercent - a.marginPercent);

        const categoryValues = filteredInventory.reduce((acc, item) => {
            if (item.cost && item.stock > 0) {
                const category = item.category || 'Uncategorized';
                acc[category] = (acc[category] || 0) + (item.cost * item.stock);
            }
            return acc;
        }, {} as Record<string, number>);

        const categoryValueData = Object.entries(categoryValues)
            .map(([name, value]) => ({ name, value: Number(value) }))
            .sort((a, b) => b.value - a.value);

        return {
            totalInventoryValue,
            itemsWithPricing: itemsWithPricing.length,
            averageMargin: profitMargins.length > 0 ? profitMargins.reduce((sum, item) => sum + item.marginPercent, 0) / profitMargins.length : 0,
            topProfitableItems: profitMargins.slice(0, 10),
            categoryValueData
        };
    }, [filteredInventory]);

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Inventory Reports</h1>

            {/* Filters Section */}
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg flex flex-wrap items-center gap-4">
                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mr-4">Filters:</h3>
                <div>
                    <label htmlFor="category-filter" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Category</label>
                    <select
                        id="category-filter"
                        value={selectedCategory}
                        onChange={e => setSelectedCategory(e.target.value)}
                        className="mt-1 block w-48 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                        {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="start-date" className="block text-sm font-medium text-gray-500 dark:text-gray-400">Start Date</label>
                    <input
                        type="date"
                        id="start-date"
                        name="start"
                        value={dateRange.start}
                        onChange={handleDateChange}
                        className="mt-1 block w-48 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>
                 <div>
                    <label htmlFor="end-date" className="block text-sm font-medium text-gray-500 dark:text-gray-400">End Date</label>
                    <input
                        type="date"
                        id="end-date"
                        name="end"
                        value={dateRange.end}
                        onChange={handleDateChange}
                        className="mt-1 block w-48 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {renderChart("Inventory Stock Status Distribution", 
                    <BarChart data={stockStatusDistribution} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(107, 114, 128, 0.3)" />
                        <XAxis type="number" stroke="rgb(156 163 175)" />
                        <YAxis type="category" dataKey="name" stroke="rgb(156 163 175)" width={120} tick={{fontSize: 12}} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(107, 114, 128, 0.1)' }} />
                        <Bar dataKey="value" name="Items Count" barSize={20}>
                            {stockStatusDistribution.map((entry, index) => {
                                let color = '#4f46e5';
                                switch(entry.name) {
                                    case 'Healthy Stock': color = '#10b981'; break;
                                    case 'Low Stock': color = '#f59e0b'; break;
                                    case 'Out of Stock': color = '#ef4444'; break;
                                    case 'Over Stock': color = '#8b5cf6'; break;
                                }
                                return <Cell key={`cell-${index}`} fill={color} />;
                            })}
                        </Bar>
                    </BarChart>,
                    stockStatusDistribution
                )}
                 {renderChart(`Top 5 Most Stocked Items ${selectedCategory !== 'All' ? `in ${selectedCategory}` : ''}`,
                    <BarChart data={topMostStocked} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(107, 114, 128, 0.3)" />
                        <XAxis type="number" stroke="rgb(156 163 175)" />
                        <YAxis type="category" dataKey="name" stroke="rgb(156 163 175)" width={120} tick={{fontSize: 12}} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(107, 114, 128, 0.1)' }} />
                        <Bar dataKey="stock" name="Current Stock" fill="#82ca9d" barSize={20} />
                    </BarChart>,
                    topMostStocked
                )}
                {renderChart("Top 10 Most Used Items",
                    <BarChart data={mostUsedItems} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(107, 114, 128, 0.3)" />
                        <XAxis type="number" stroke="rgb(156 163 175)" allowDecimals={false} />
                        <YAxis type="category" dataKey="name" stroke="rgb(156 163 175)" width={120} tick={{fontSize: 12}} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(107, 114, 128, 0.1)' }} />
                        <Bar dataKey="used" name="Units Used" fill="#ff7300" barSize={20} />
                    </BarChart>,
                    mostUsedItems
                )}
                {renderChart("Recent Stock Movement (Net Change)",
                    <LineChart data={recentStockMovement} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(107, 114, 128, 0.3)" />
                        <XAxis dataKey="date" stroke="rgb(156 163 175)" />
                        <YAxis stroke="rgb(156 163 175)" />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend />
                        {recentStockMovement.length > 0 && Object.keys(recentStockMovement[0] || {}).filter(k => k !== 'date').map((key, i) => {
                            const colors = ['#4f46e5', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];
                            return (
                                <Line 
                                    key={key} 
                                    type="monotone" 
                                    dataKey={key} 
                                    stroke={colors[i % colors.length]} 
                                    strokeWidth={2}
                                    dot={{ r: 4 }}
                                />
                            );
                        })}
                    </LineChart>,
                    recentStockMovement
                )}
            </div>

            {/* Pricing Analytics Section */}
            {pricingAnalytics.itemsWithPricing > 0 && (
                <>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-12 mb-6">Pricing & Value Analytics</h2>
                    
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Total Inventory Value</h3>
                            <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-2">
                                R{pricingAnalytics.totalInventoryValue.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}
                            </p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Items with Pricing</h3>
                            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400 mt-2">
                                {pricingAnalytics.itemsWithPricing} / {filteredInventory.length}
                            </p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Average Profit Margin</h3>
                            <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mt-2">
                                {pricingAnalytics.averageMargin.toFixed(1)}%
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Inventory Value by Category */}
                        {renderChart("Inventory Value by Category (ZAR)", 
                            <PieChart>
                                <Pie
                                    data={pricingAnalytics.categoryValueData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    label={({ name, percent }: any) => `${name} (${(percent * 100).toFixed(0)}%)`}
                                    outerRadius={100}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {pricingAnalytics.categoryValueData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip 
                                    content={<ChartTooltip />} 
                                    formatter={(value: any) => [`R${value.toLocaleString('en-ZA')}`, 'Value']}
                                />
                            </PieChart>,
                            pricingAnalytics.categoryValueData
                        )}

                        {/* Top Profitable Items */}
                        {pricingAnalytics.topProfitableItems.length > 0 && renderChart("Top Profitable Items (Margin %)", 
                            <BarChart data={pricingAnalytics.topProfitableItems.slice(0, 8)} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(107, 114, 128, 0.3)" />
                                <XAxis 
                                    dataKey="name" 
                                    stroke="rgb(156 163 175)" 
                                    angle={-45}
                                    textAnchor="end"
                                    height={80}
                                    tick={{fontSize: 10}}
                                />
                                <YAxis stroke="rgb(156 163 175)" />
                                <Tooltip 
                                    content={<ChartTooltip />}
                                    formatter={(value: any, name: string) => {
                                        if (name === 'marginPercent') return [`${value.toFixed(1)}%`, 'Profit Margin'];
                                        return [value, name];
                                    }}
                                />
                                <Bar dataKey="marginPercent" name="Profit Margin %" fill="#10b981" />
                            </BarChart>,
                            pricingAnalytics.topProfitableItems
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default ReportsView;