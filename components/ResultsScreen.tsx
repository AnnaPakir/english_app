
import React from 'react';
import { Button } from './common/Button';
import { Card } from './common/Card';
import { CEFRLevel } from '../types';

interface ResultsScreenProps {
    level: CEFRLevel;
    onStartLearning: () => void;
}

export const ResultsScreen: React.FC<ResultsScreenProps> = ({ level, onStartLearning }) => (
    <div className="min-h-screen flex items-center justify-center fade-in">
        <Card className="text-center">
            <h1 className="text-3xl font-bold mb-2">Assessment Complete!</h1>
            <p className="text-gray-400 mb-4">We've assessed your level as:</p>
            <p className="text-5xl font-bold text-indigo-400 mb-8">{level.split(' ')[0]}</p>
            <Button onClick={onStartLearning}>Start Learning</Button>
        </Card>
    </div>
);
