import React from 'react';
import { Button } from './common/Button';
import { Card } from './common/Card';
import { User } from '../types';

interface WelcomeScreenProps {
    user: User;
    onStart: () => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ user, onStart }) => {
    return (
        <div className="flex flex-col items-center justify-center py-12">
            <Card className="max-w-2xl text-center animate-fade-in-up">
                <img src={user.imageUrl} alt={user.name} className="w-24 h-24 rounded-full mx-auto mb-4 border-4 border-slate-700" />
                <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500 mb-4">
                    Добро пожаловать, {user.name}!
                </h1>
                <p className="text-slate-300 text-lg mb-8">
                    Пройдите быстрый тест, чтобы определить свой уровень, и получите персонализированные задания для изучения английского языка.
                </p>
                <Button onClick={onStart} className="px-8 py-3 text-lg">
                    Начать тест
                </Button>
            </Card>
        </div>
    );
};

export default WelcomeScreen;
