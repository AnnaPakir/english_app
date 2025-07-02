import React, { useState } from 'react';
import { AssessmentQuestion, CEFRLevel } from '../types.ts';
import { Button } from './common/Button.tsx';
import { Card } from './common/Card.tsx';
import { CEFR_LEVELS_ORDER } from '../constants.ts';

interface AssessmentProps {
    questions: AssessmentQuestion[];
    onComplete: (level: CEFRLevel) => void;
}

const Assessment: React.FC<AssessmentProps> = ({ questions, onComplete }) => {
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [isAnswered, setIsAnswered] = useState(false);
    const [scores, setScores] = useState<Record<string, number>>({
        [CEFRLevel.A1]: 0,
        [CEFRLevel.A2]: 0,
        [CEFRLevel.B1]: 0,
        [CEFRLevel.B2]: 0,
        [CEFRLevel.C1]: 0,
    });

    const currentQuestion = questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

    const handleAnswerSelect = (option: string) => {
        if (isAnswered) return;
        setSelectedAnswer(option);
        setIsAnswered(true);

        if (option === currentQuestion.correctAnswer) {
            setScores(prev => ({
                ...prev,
                [currentQuestion.level]: (prev[currentQuestion.level] || 0) + 1
            }));
        }
    };

    const determineLevel = (): CEFRLevel => {
        const questionsPerLevel: Record<string, number> = {};
        questions.forEach(q => {
            questionsPerLevel[q.level] = (questionsPerLevel[q.level] || 0) + 1;
        });

        let determinedLevel = CEFRLevel.A1;
        for (const level of CEFR_LEVELS_ORDER) {
            const correctCount = scores[level] || 0;
            const totalCount = questionsPerLevel[level] || 0;
            if (totalCount > 0 && correctCount / totalCount >= 0.5) {
                determinedLevel = level;
            } else if (totalCount > 0) {
                break;
            }
        }
        return determinedLevel;
    };

    const handleNext = () => {
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
            setSelectedAnswer(null);
            setIsAnswered(false);
        } else {
            const finalLevel = determineLevel();
            onComplete(finalLevel);
        }
    };

    const getButtonClass = (option: string) => {
        if (!isAnswered) {
            return 'bg-slate-700 hover:bg-slate-600';
        }
        if (option === currentQuestion.correctAnswer) {
            return 'bg-green-600';
        }
        if (option === selectedAnswer) {
            return 'bg-red-600';
        }
        return 'bg-slate-700 opacity-60';
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <Card className="w-full max-w-2xl">
                <div className="mb-4">
                    <div className="flex justify-between mb-1">
                        <span className="text-base font-medium text-indigo-400">Прогресс</span>
                        <span className="text-sm font-medium text-indigo-400">{currentQuestionIndex + 1} / {questions.length}</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2.5">
                        <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                    </div>
                </div>

                <h2 className="text-2xl font-bold text-slate-100 mb-2">{`Вопрос ${currentQuestionIndex + 1}`}</h2>
                <p className="text-slate-300 text-lg mb-6">{currentQuestion.question}</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    {currentQuestion.options.map((option, index) => (
                        <button
                            key={index}
                            onClick={() => handleAnswerSelect(option)}
                            disabled={isAnswered}
                            className={`w-full p-4 rounded-lg text-left transition-colors duration-300 ${getButtonClass(option)}`}
                        >
                            {option}
                        </button>
                    ))}
                </div>

                {isAnswered && (
                    <div className="text-right">
                        <Button onClick={handleNext}>
                            {currentQuestionIndex < questions.length - 1 ? 'Следующий вопрос' : 'Завершить'}
                        </Button>
                    </div>
                )}
            </Card>
        </div>
    );
};

export default Assessment;