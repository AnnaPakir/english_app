
import React, { useState, useEffect } from 'react';
import { GeminiService } from '../services/geminiService';
import { Loader } from './common/Loader';
import { Card } from './common/Card';
import { AssessmentAnswer, AssessmentQuestion } from '../types';

interface AssessmentScreenProps {
    gemini: GeminiService;
    onComplete: (answers: AssessmentAnswer[]) => void;
}

export const AssessmentScreen: React.FC<AssessmentScreenProps> = ({ gemini, onComplete }) => {
    const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState<AssessmentAnswer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchAssessment = async () => {
            try {
                const fetchedQuestions = await gemini.getInitialAssessment();
                if (fetchedQuestions && fetchedQuestions.length > 0) {
                    setQuestions(fetchedQuestions);
                } else {
                    setError("Could not load the assessment questions.");
                }
            } catch (err) {
                console.error("Failed to load assessment:", err);
                setError("Could not load the assessment. Please try again later.");
            } finally {
                setIsLoading(false);
            }
        };
        fetchAssessment();
    }, [gemini]);

    const handleAnswer = (answer: string, question: AssessmentQuestion) => {
        const newAnswers = [...answers, { question: question.question, answer, correctAnswer: question.correctAnswer }];
        setAnswers(newAnswers);
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(currentQuestionIndex + 1);
        } else {
            onComplete(newAnswers);
        }
    };

    if (isLoading) return <Loader text="Preparing your assessment..." />;
    if (error) return <Card><p className="text-red-400">{error}</p></Card>;
    if (!questions.length) return <Card><p>Could not load questions.</p></Card>;
    
    const question = questions[currentQuestionIndex];

    return (
        <div className="min-h-screen flex items-center justify-center fade-in">
            <Card className="w-full max-w-2xl">
                <p className="text-sm text-gray-400 mb-2">Question {currentQuestionIndex + 1} of {questions.length}</p>
                <h2 className="text-2xl font-semibold mb-6">{question.question}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {question.options.map((option, i) => (
                        <button type="button" key={i} onClick={() => handleAnswer(option, question)} className="w-full text-left p-4 bg-gray-800 hover:bg-indigo-500 rounded-lg transition-colors">
                            {option}
                        </button>
                    ))}
                </div>
            </Card>
        </div>
    );
};
