import React from 'react';
import { User, CEFRLevel, UserData } from '../types.ts';
import { Button } from './common/Button.tsx';

interface HeaderProps {
    user: User;
    onReset: () => void;
    level: CEFRLevel | null;
    dailyStats: UserData['dailyStats'];
}

const Header: React.FC<HeaderProps> = ({ user, onReset, level, dailyStats }) => {
    return (
        <header className="py-4 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto flex justify-between items-center border-b border-slate-700 pb-4">
                <div className="flex items-center gap-3">
                    <img src={user.imageUrl} alt={user.name} className="w-10 h-10 rounded-full border-2 border-slate-600" />
                    <div className="flex items-center gap-x-3 flex-wrap">
                        <h1 className="font-bold text-slate-100">{user.name}</h1>
                        {level && (
                             <span className="bg-indigo-600/50 text-indigo-300 text-xs font-medium px-2.5 py-0.5 rounded-full border border-indigo-500">{level}</span>
                        )}
                        <div className="text-sm text-slate-400">
                            <span>Задания сегодня: </span>
                            <span className="font-bold text-green-400">{dailyStats.correct}</span>
                            <span> / </span>
                            <span className="font-bold text-slate-300">{dailyStats.completed}</span>
                        </div>
                    </div>
                </div>
                <Button onClick={onReset} variant="secondary">
                    Выйти
                </Button>
            </div>
        </header>
    );
};

export default Header;