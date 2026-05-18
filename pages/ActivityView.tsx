import React, { useMemo, useState } from 'react';
import ActivityLog from '../components/ActivityLog';
import { useAppContext } from '../context/AppContext';
import ConfirmationModal from '../components/ConfirmationModal';
import { activityLogger } from '../services/activityLogger';

const ActivityView: React.FC = () => {
    const { state, dispatch } = useAppContext();
    const [showArchiveModal, setShowArchiveModal] = useState(false);

    // Calculate activity statistics (only count active, non-archived logs)
    const activityStats = useMemo(() => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        // Filter to only active (non-archived) logs
        const activeLogs = state.activityLogs.filter(log => !log.archived);
        const archivedLogs = state.activityLogs.filter(log => log.archived);
        
        const recentCount = activeLogs.filter(log => {
            const logDate = new Date(log.timestamp);
            return logDate > twoHoursAgo;
        }).length;
        
        const todayCount = activeLogs.filter(log => {
            const logDate = new Date(log.timestamp);
            return logDate > twentyFourHoursAgo;
        }).length;
        
        return {
            total: state.activityLogs.length, // Total includes archived
            active: activeLogs.length,
            archived: archivedLogs.length,
            recent: recentCount,
            today: todayCount,
            hidden: activeLogs.length - recentCount
        };
    }, [state.activityLogs]);

    const handleArchiveAll = () => {
        dispatch({ type: 'ARCHIVE_ALL_LOGS' });
        setShowArchiveModal(false);
    };

    return (
        <div className="space-y-6">
            {/* Activity Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Recent Activity</p>
                            <p className="text-2xl font-semibold text-green-600 dark:text-green-400">{activityStats.recent}</p>
                        </div>
                        <div className="w-8 h-8 bg-green-100 dark:bg-green-900/50 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Last 2 hours</p>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Today's Activity</p>
                            <p className="text-2xl font-semibold text-blue-600 dark:text-blue-400">{activityStats.today}</p>
                        </div>
                        <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Last 24 hours</p>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Hidden Entries</p>
                            <p className="text-2xl font-semibold text-yellow-600 dark:text-yellow-400">{activityStats.hidden}</p>
                        </div>
                        <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/50 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L12 12l-3.29-3.29m7.532 7.532L12 12m3.29 3.29a1 1 0 001.414-1.414L12 12m-8.485 8.485a1 1 0 001.414-1.414L12 12" />
                            </svg>
                        </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-hidden (2h+)</p>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Active Records</p>
                            <p className="text-2xl font-semibold text-gray-600 dark:text-gray-400">{activityStats.active}</p>
                        </div>
                        <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Visible logs ({activityStats.archived} archived)</p>
                </div>
            </div>

            {/* Archive Controls */}
            {activityStats.active > 0 && (
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Activity Log Management</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                Archive logs to clean up the interface. Archived logs are kept in the backend but hidden from view.
                                {activityStats.archived > 0 && (
                                    <span className="ml-1 text-blue-600 dark:text-blue-400">
                                        ({activityStats.archived} logs already archived)
                                    </span>
                                )}
                            </p>
                        </div>
                        <button
                            onClick={() => setShowArchiveModal(true)}
                            className="flex items-center px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors duration-200"
                        >
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8l6 6 6-6" />
                            </svg>
                            Archive All Logs
                        </button>
                    </div>
                </div>
            )}

            {/* Activity Log Component */}
            <ActivityLog logs={state.activityLogs} />

            {/* Archive Confirmation Modal */}
            <ConfirmationModal
                isOpen={showArchiveModal}
                onClose={() => setShowArchiveModal(false)}
                onConfirm={handleArchiveAll}
                title="Archive All Activity Logs"
                message={`Are you sure you want to archive all ${activityStats.active} active logs? This will clear them from the interface but keep them in the backend. This action cannot be undone.`}
                confirmText="Archive All"
                cancelText="Cancel"
                type="warning"
            />
        </div>
    );
};

export default ActivityView;