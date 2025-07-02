import React from 'react';
import { PROGRESS_HISTORY_LENGTH, PROGRESS_UNLOCK_THRESHOLD } from '../constants';

interface ProgressTrackerProps {
    history: boolean[];
}

const ProgressTracker: React.FC<ProgressTrackerProps> = ({ history }) => {
    const correctCount = history.filter(h => h).length;
    const progressPercentage = Math.min((correctCount / PROGRESS_UNLOCK_THRESHOLD) * 100, 100);

    return (
        <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-lg p-4">
            <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-slate-200">Прогресс к следующему уровню</h3>
                <span className="text-lg font-mono font-bold text-indigo-300">{correctCount} / {PROGRESS_UNLOCK_THRESHOLD}</span>
            </div>
            <p className="text-sm text-slate-400 mb-3">
                Правильно ответьте на {PROGRESS_UNLOCK_THRESHOLD} из последних {PROGRESS_HISTORY_LENGTH} заданий, чтобы разблокировать тест на повышение уровня.
            </p>
            <div className="w-full bg-slate-700 rounded-full h-4 relative overflow-hidden">
                <div 
                    className="bg-gradient-to-r from-teal-400 to-indigo-500 h-4 rounded-full transition-all duration-500 ease-out" 
                    style={{ width: `${progressPercentage}%` }}
                ></div>
            </div>
        </div>
    );
};

export default ProgressTracker;
