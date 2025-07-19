
import React, { useState, useEffect } from 'react';
import { GeminiService } from '../services/geminiService';
import { UserData, LearningTask } from '../types';
import { Loader } from './common/Loader';
import { Card } from './common/Card';
import { Button } from './common/Button';
import { LONG_TERM_TASK_HISTORY_LENGTH, RECENTLY_INTRODUCED_WORDS_MEMORY, VOCABULARY_MASTERY_THRESHOLD } from '../constants';

// --- Local Components & Services ---
const IconWrapper = ({ children, className = '' }: { children: React.ReactNode, className?: string }) => <div className={`flex-shrink-0 ${className}`}>{children}</div>;
const CheckCircleIcon = () => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-green-400"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg></IconWrapper>);
const XCircleIcon = () => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-red-400"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" /></svg></IconWrapper>);
const SpeakerWaveIcon = ({ className = "w-6 h-6" }) => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}><path fillRule="evenodd" d="M.75 9.75a.75.75 0 01.75-.75h2.25c.414 0 .75.336.75.75v4.5c0 .414-.336.75-.75.75H1.5a.75.75 0 01-.75-.75V9.75zM6 8.25a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm3.75 0a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm3.75.75a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0V9zm3-1.5a.75.75 0 01.75.75v7.5a.75.75 0 01-1.5 0V8.25a.75.75 0 01.75-.75zm3.75-.75a.75.75 0 00-1.5 0v9a.75.75 0 001.5 0V6.75z" clipRule="evenodd" /></svg></IconWrapper>);

class TextToSpeechService {
    static speak(text: string) {
        if (!text || typeof window.speechSynthesis === 'undefined') {
            console.warn('Speech synthesis not available or no text provided.');
            return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        window.speechSynthesis.speak(utterance);
    }
}

const TaskFeedback = ({ isCorrect, explanation, onNext }: { isCorrect: boolean, explanation: string, onNext: () => void }) => (
    <Card className="flex flex-col items-center space-y-4 text-center fade-in">
        {isCorrect ? <CheckCircleIcon /> : <XCircleIcon />}
        <h2 className={`text-2xl font-bold ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>{isCorrect ? "Correct!" : "Incorrect"}</h2>
        <p className="text-gray-300">{explanation}</p>
        <Button onClick={onNext} className="mt-4">Next Task</Button>
    </Card>
);

// --- Main Component ---
interface LearningDashboardProps {
    gemini: GeminiService;
    userData: UserData;
    saveData: (data: UserData) => Promise<void>;
}

export const LearningDashboard: React.FC<LearningDashboardProps> = ({ gemini, userData, saveData }) => {
    const [task, setTask] = useState<LearningTask | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [answer, setAnswer] = useState('');
    const [feedback, setFeedback] = useState<{ isCorrect: boolean; explanation: string } | null>(null);
    const [builtSentenceParts, setBuiltSentenceParts] = useState<{ part: string; id: string }[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!userData || !gemini) return;

        setIsLoading(true);
        setFeedback(null);
        setAnswer('');
        setBuiltSentenceParts([]);
        setError(null);

        gemini.generateLearningTask(userData)
            .then(nextTask => {
                 if (!nextTask || !nextTask.type) {
                    throw new Error("Received an invalid task from the API.");
                }
                if (nextTask.type === 'BuildSentence' && nextTask.parts) {
                    nextTask.augmentedParts = nextTask.parts.map((part, index) => ({
                        part,
                        id: `${part}-${index}`
                    }));
                }
                setTask(nextTask);
            })
            .catch(err => {
                console.error("Failed to generate task:", err);
                setError("Could not generate a new task. Please check your connection or API key and try refreshing.");
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [gemini, userData]);

    const handleCheckAnswer = () => {
        if (!task) return;
        let isCorrect = false;
        let userAnswer = answer.trim();

        if (task.type === 'BuildSentence') {
            userAnswer = builtSentenceParts.map(p => p.part).join(' ');
        }
        
        const normalize = (str: string) => str.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g,"").replace(/\s+/g, ' ').trim();
        isCorrect = normalize(userAnswer) === normalize(task.correctAnswer);
        
        const explanation = isCorrect ? task.explanation : `${task.explanation} The correct answer was: "${task.correctAnswer}"`;
        setFeedback({ isCorrect, explanation });
    };
    
    const handleNext = async () => {
        if (!task || !feedback) return;
        const newUserData = JSON.parse(JSON.stringify(userData));

        newUserData.tasksCompleted = (newUserData.tasksCompleted || 0) + 1;
        newUserData.taskHistory = [...(newUserData.taskHistory || []), task.type].slice(-LONG_TERM_TASK_HISTORY_LENGTH);

        const { wordToLearn } = task;
        
        if (wordToLearn) {
            let vocabulary = newUserData.vocabulary || [];
            const wordIndex = vocabulary.findIndex(v => v.word.toLowerCase() === wordToLearn.toLowerCase());

            if (wordIndex !== -1) { 
                if (feedback.isCorrect) {
                    vocabulary[wordIndex].mastery += 1;
                } else {
                    vocabulary[wordIndex].mastery = Math.max(0, vocabulary[wordIndex].mastery - 5);
                }

                if (vocabulary[wordIndex].mastery >= VOCABULARY_MASTERY_THRESHOLD) {
                    newUserData.vocabulary = vocabulary.filter((_, i) => i !== wordIndex);
                } else {
                    newUserData.vocabulary = vocabulary;
                }
            } else if (task.type === 'WordDefinition' && feedback.isCorrect) {
                vocabulary.push({ word: wordToLearn, mastery: 1 });
                newUserData.vocabulary = vocabulary;

                const recentWords = (newUserData.recentNewWords || []).slice(-RECENTLY_INTRODUCED_WORDS_MEMORY + 1);
                recentWords.push(wordToLearn);
                newUserData.recentNewWords = recentWords;
            }
        }

        await saveData(newUserData);
    };


    const renderTaskInput = () => {
        if (!task) return null;
        switch (task.type) {
            case 'Listen':
            case 'Translate':
            case 'CorrectTheMistake':
            case 'FillInTheBlank':
                return (<input type="text" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer..." className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"/>);
            case 'MultipleChoice':
            case 'SynonymsAndAntonyms':
            case 'MatchDefinition':
            case 'OddOneOut':
            case 'Categorization': {
                if (!task.options || !Array.isArray(task.options)) {
                    return <p className="text-red-400">Error: Task data is corrupted (missing options).</p>;
                }
                return (<div className="grid grid-cols-1 md:grid-cols-2 gap-4">{task.options.map(opt => (<button type="button" key={opt} onClick={() => setAnswer(opt)} className={`p-3 rounded-lg transition-colors text-left ${answer === opt ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'}`}>{opt}</button>))}</div>);
            }
            case 'BuildSentence': {
                if (!task.augmentedParts || !Array.isArray(task.augmentedParts)) {
                    return <p className="text-red-400">Error: Task data is corrupted (missing parts).</p>;
                }
                const builtPartIds = new Set(builtSentenceParts.map(p => p.id));
                const remainingParts = task.augmentedParts.filter(p => !builtPartIds.has(p.id));

                return (
                    <div>
                        <div className="bg-gray-800 p-3 rounded-lg min-h-[50px] mb-4 border border-gray-700 flex flex-wrap gap-2 items-center">
                            {builtSentenceParts.length === 0 && <span className="text-gray-500">Click words below to build the sentence</span>}
                            {builtSentenceParts.map((p) => (
                                <button type="button" key={p.id} className="bg-indigo-500 px-3 py-1 rounded-md" onClick={() => {
                                    setBuiltSentenceParts(currentParts => currentParts.filter(item => item.id !== p.id));
                                }}>
                                    {p.part}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {remainingParts.map((p) => (
                                <button type="button" key={p.id} className="bg-gray-700 px-3 py-1 rounded-md hover:bg-gray-600" onClick={() => {
                                    setBuiltSentenceParts(currentParts => [...currentParts, p]);
                                }}>
                                    {p.part}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            }
            case 'WordDefinition':
                 return <p className="text-gray-400 p-4 bg-gray-800 rounded-lg">{task.explanation}</p>;
            default: return null;
        }
    };

    if (isLoading) return <Loader text="Generating your next challenge..." />;
    if (error) return <Card className="text-center"><p className="text-red-400">{error}</p></Card>;
    if (!task) return (
         <Card className="text-center">
            <h2 className="text-xl font-semibold">All done for now!</h2>
            <p className="text-gray-400">Could not load a task. Please try refreshing.</p>
        </Card>
    );

    if (feedback) {
        return <TaskFeedback isCorrect={feedback.isCorrect} explanation={feedback.explanation} onNext={handleNext} />;
    }
    
    const isAnswerProvided = answer.trim() !== '' || (task.type === 'BuildSentence' && builtSentenceParts.length > 0);

    return (
        <Card className="w-full max-w-2xl fade-in">
            <p className="text-sm font-medium text-indigo-400 mb-2">{task.type.replace(/([A-Z])/g, ' $1').trim()}</p>
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-4">
                {task.question}
                {task.audioPrompt && <button type="button" onClick={() => TextToSpeechService.speak(task.audioPrompt)} aria-label="Listen to prompt"><SpeakerWaveIcon /></button>}
            </h2>
            <div className="space-y-4">
                {renderTaskInput()}
                 {task.type === 'WordDefinition' ? (
                     <Button onClick={() => setFeedback({isCorrect: true, explanation: task.explanation})} className="w-full">Got it!</Button>
                 ) : (
                    <Button onClick={handleCheckAnswer} disabled={!isAnswerProvided} className="w-full">Check Answer</Button>
                 )}
            </div>
        </Card>
    );
};
