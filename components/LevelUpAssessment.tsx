import React, { useState, useEffect } from 'react';
import { AssessmentQuestion } from '../types.ts';
import { Card } from './common/Card.tsx';
import { LEVEL_UP_PASS_PERCENTAGE } from '../constants.ts';
import { Loader } from './common/Loader.tsx';

interface LevelUpAssessmentProps {
    questions: AssessmentQuestion[];
    onComplete: (score: number) => void;
}

const LevelUpAssessment: React.FC<LevelUpAssessmentProps> = ({ questions, onComplete }) => {
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [correctAnswersCount, setCorrectAnswersCount] = useState(0);
    const [isFinished, setIsFinished] = useState(false);

    useEffect(() => {
        if (questions.length > 0 && currentQuestionIndex >= questions.length && !isFinished) {
            setIsFinished(true); // Prevent multiple calls
            onComplete(correctAnswersCount / questions.length);
        }
    }, [currentQuestionIndex, correctAnswersCount, questions.length, onComplete, isFinished]);


    const handleAnswerSelect = (option: string) => {
        if (selectedAnswer) return; // Prevent multiple answers

        setSelectedAnswer(option);
        if (option === questions[currentQuestionIndex].correctAnswer) {
            setCorrectAnswersCount(prev => prev + 1);
        }
        
        setTimeout(() => {
            setCurrentQuestionIndex(prev => prev + 1);
            setSelectedAnswer(null);
        }, 500);
    };

    if (currentQuestionIndex >= questions.length) {
        return (
             <div className="flex flex-col items-center justify-center min-h-screen p-4">
                <Loader text="Подсчет результатов..." />
            </div>
        );
    }
    
    const currentQuestion = questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / questions.length) * 100;
    const passThresholdText = `${LEVEL_UP_PASS_PERCENTAGE * 100}%`;


    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <Card className="w-full max-w-2xl">
                <div className="mb-6">
                    <h2 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500 mb-2">Тест на повышение уровня</h2>
                    <p className="text-center text-slate-400">Для прохождения нужно ответить правильно на {passThresholdText} вопросов.</p>
                </div>

                <div className="mb-4">
                    <div className="flex justify-between mb-1">
                        <span className="text-base font-medium text-indigo-400">Прогресс</span>
                        <span className="text-sm font-medium text-indigo-400">{currentQuestionIndex + 1} / {questions.length}</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2.5">
                        <div className="bg-indigo-600 h-2.5 rounded-full transition-width duration-300" style={{ width: `${progress}%` }}></div>
                    </div>
                </div>

                <h3 className="text-2xl font-bold text-slate-100 mb-2">{`Вопрос ${currentQuestionIndex + 1}`}</h3>
                <p className="text-slate-300 text-lg mb-6">{currentQuestion.question}</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {currentQuestion.options.map((option, index) => (
                        <button
                            key={index}
                            onClick={() => handleAnswerSelect(option)}
                            disabled={!!selectedAnswer}
                            className={`w-full p-4 rounded-lg text-left transition-colors duration-300 
                                ${selectedAnswer === null ? 'bg-slate-700 hover:bg-slate-600' : ''}
                                ${selectedAnswer === option && option === currentQuestion.correctAnswer ? 'bg-green-600' : ''}
                                ${selectedAnswer === option && option !== currentQuestion.correctAnswer ? 'bg-red-600' : ''}
                                ${selectedAnswer !== null && selectedAnswer !== option ? 'bg-slate-700 opacity-50' : ''}
                            `}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            </Card>
        </div>
    );
};

export default LevelUpAssessment;