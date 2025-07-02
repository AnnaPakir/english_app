import React from 'react';
import { CEFRLevel } from '../types';
import { Button } from './common/Button';
import { Card } from './common/Card';

interface ResultsScreenProps {
    level: CEFRLevel;
    onStartLearning: () => void;
}

const ResultsScreen: React.FC<ResultsScreenProps> = ({ level, onStartLearning }) => {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <Card className="max-w-xl text-center animate-fade-in-up">
                <h2 className="text-3xl font-bold text-slate-100 mb-2">Тест завершен!</h2>
                <p className="text-slate-300 text-lg mb-4">Ваш предполагаемый уровень владения английским:</p>
                <div className="bg-indigo-600 text-white text-4xl font-bold rounded-lg py-4 px-8 inline-block mb-8">
                    {level}
                </div>
                <p className="text-slate-400 mb-8">Теперь вы готовы начать выполнять задания, соответствующие вашему уровню.</p>
                <Button onClick={onStartLearning} className="px-8 py-3 text-lg">
                    Начать обучение
                </Button>
            </Card>
        </div>
    );
};

export default ResultsScreen;
