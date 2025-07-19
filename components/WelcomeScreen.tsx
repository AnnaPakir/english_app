
import React from 'react';
import { Button } from './common/Button';
import { Card } from './common/Card';

interface WelcomeScreenProps {
    userName: string;
    onStartAssessment: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ userName, onStartAssessment }) => (
    <div className="min-h-screen flex items-center justify-center fade-in">
        <Card className="text-center max-w-lg">
            <h1 className="text-3xl font-bold mb-2">Welcome, {userName}!</h1>
            <p className="text-gray-300 mb-6">To personalize your learning journey, let's start with a quick assessment to determine your English level.</p>
            <Button onClick={onStartAssessment}>Start Assessment</Button>
        </Card>
    </div>
);
