import React, { useState, useCallback, useEffect } from 'react';
import { LearningTask, UserData, TaskType, TaskEvaluation } from '../types.ts';
import { GeminiService } from '../services/geminiService.ts';
import { Button } from './common/Button.tsx';
import { Card } from './common/Card.tsx';
import { Loader } from './common/Loader.tsx';
import ProgressTracker from './ProgressTracker.tsx';
import { PROGRESS_UNLOCK_THRESHOLD } from '../constants.ts';

interface LearningDashboardProps {
    userData: UserData;
    geminiService: GeminiService;
    onUserDataChange: (newUserData: UserData) => void;
    onTaskComplete: (results: boolean[]) => void;
    onStartLevelUpTest: () => void;
    onFeedbackSubmit: (feedback: string) => void;
}

const INTERACTIVE_TASK_TYPES: TaskType[] = ['dialogue', 'story', 'editing'];

const LearningDashboard: React.FC<LearningDashboardProps> = ({ userData, geminiService, onUserDataChange, onTaskComplete, onStartLevelUpTest, onFeedbackSubmit }) => {
    const [task, setTask] = useState<LearningTask | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Quiz states
    const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
    const [taskResults, setTaskResults] = useState<boolean[]>([]);
    const [explanations, setExplanations] = useState<Record<number, string | null>>({});
    
    // Interactive task states
    const [userInput, setUserInput] = useState("");
    const [evaluation, setEvaluation] = useState<TaskEvaluation | null>(null);

    // General states
    const [showResults, setShowResults] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    
    // Image states
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const imageLimit = 10;
    
    // Feedback states
    const [showFeedbackForm, setShowFeedbackForm] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");
    const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);


    const imagesGeneratedToday = userData.imageGeneration.count;
    const limitReached = imagesGeneratedToday >= imageLimit;
    
    const level = userData.level!;
    const canAttemptLevelUp = (userData.taskHistory.filter(Boolean).length >= PROGRESS_UNLOCK_THRESHOLD);
    const isInteractiveTask = task?.type && INTERACTIVE_TASK_TYPES.includes(task.type);

    const resetLocalState = () => {
        setTask(null);
        setSelectedAnswers({});
        setShowResults(false);
        setTaskResults([]);
        setExplanations({});
        setIsChecking(false);
        setGeneratedImage(null);
        setIsGeneratingImage(false);
        setUserInput("");
        setEvaluation(null);
        setShowFeedbackForm(false);
        setFeedbackText("");
        setFeedbackSubmitted(false);
    };

    const fetchTask = useCallback(async (isRetry: boolean = false) => {
        if (!isRetry) {
            resetLocalState();
            setIsLoading(true);
            setError(null);
        } else {
            setError(null);
            setIsLoading(true);
        }
        
        try {
            const newTask = await geminiService.generateLearningTask(level, userData.feedbackHistory);
            if (!newTask) {
                 throw new Error("Received empty task from API.");
            }
            setTask(newTask);
        } catch (err: any) {
            setError(err.message || 'An unknown error occurred.');
        } finally {
            setIsLoading(false);
        }
    }, [level, geminiService, userData.feedbackHistory]);

    useEffect(() => {
        fetchTask();
    }, [fetchTask]);
    
    const handleGenerateImage = async (prompt: string) => {
        if (limitReached) return;
        setIsGeneratingImage(true);
        setError(null);
        try {
            const imageUrl = await geminiService.generateImage(prompt);
            setGeneratedImage(imageUrl);
            const newUserData = { ...userData };
            newUserData.imageGeneration.count++;
            onUserDataChange(newUserData);
        } catch (err: any) {
            setError(err.message || "Failed to generate image.");
        } finally {
            setIsGeneratingImage(false);
        }
    };
    
    const handleCheckAnswers = async () => {
        if (!task) return;
        setIsChecking(true);
        
        if (isInteractiveTask) {
            const result = await geminiService.evaluateTextTask(task, userInput);
            setEvaluation(result);
            onTaskComplete([result.isCorrect]);
        } else if (task.questions) {
            const newExplanations: Record<number, string> = {};
            const explanationPromises: Promise<void>[] = [];

            task.questions.forEach((q, index) => {
                const userAnswer = selectedAnswers[index];
                if (userAnswer && userAnswer !== q.correctAnswer) {
                    explanationPromises.push(
                        geminiService.getExplanation(q.question, q.correctAnswer, userAnswer)
                            .then(explanation => { newExplanations[index] = explanation; })
                    );
                }
            });

            await Promise.all(explanationPromises);
            setExplanations(newExplanations);

            const results = task.questions.map((q, i) => selectedAnswers[i] === q.correctAnswer);
            setTaskResults(results);
            onTaskComplete(results);
            
            if (task.type === 'image' && results[0] === true) {
                handleGenerateImage(task.questions[0].correctAnswer);
            }
        }
        
        setShowResults(true);
        setIsChecking(false);
    };
    
    const handleFeedbackFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (feedbackText.trim()) {
            onFeedbackSubmit(feedbackText.trim());
            setFeedbackSubmitted(true);
            setShowFeedbackForm(false);
        }
    };

    const handleNextTask = () => fetchTask();

    const renderQuizTask = () => {
        if (!task || !task.questions) return null;

        const getOptionClass = (questionIndex: number, option: string) => {
            if (!showResults) return selectedAnswers[questionIndex] === option ? 'bg-indigo-500 ring-2 ring-indigo-400' : 'bg-slate-700 hover:bg-slate-600';
            const correctAnswer = task.questions?.[questionIndex]?.correctAnswer;
            if (option === correctAnswer) return 'bg-green-600';
            if (selectedAnswers[questionIndex] === option) return 'bg-red-600';
            return 'bg-slate-700 opacity-60';
        };

        return (
            <>
                <p className="text-slate-300 text-lg mb-6 whitespace-pre-wrap">{task.content}</p>
                {task.type === 'image' && <p className="text-slate-500 text-sm mb-4 text-center">Использовано генераций сегодня: {imagesGeneratedToday} / {imageLimit}</p>}
                <div className="space-y-6">
                    {task.questions.map((q, qIndex) => (
                        <div key={qIndex}>
                            <h3 className="font-semibold text-slate-200 mb-3">{q.question}</h3>
                            <div className="grid grid-cols-1 gap-3">
                                {q.options.map((option, oIndex) => <button key={oIndex} onClick={() => !showResults && setSelectedAnswers(prev => ({ ...prev, [qIndex]: option }))} disabled={showResults} className={`p-3 rounded-lg text-left transition-colors duration-300 ${getOptionClass(qIndex, option)}`}>{option}</button>)}
                            </div>
                            {showResults && explanations[qIndex] && <div className="mt-3 p-3 bg-red-900/50 border border-red-700/50 rounded-lg"><p className="text-red-300">{explanations[qIndex]}</p></div>}
                        </div>
                    ))}
                </div>
                {task.type === 'image' && showResults && (
                    <div className="mt-6 text-center">
                        {isGeneratingImage && <Loader text="Магия Imagen в действии..." />}
                        {error && !isGeneratingImage && <p className="text-red-400">{error}</p>}
                        {generatedImage && <div className="mt-4"><p className="text-green-300 mb-4 font-semibold">Правильно! Вот ваше изображение:</p><img src={generatedImage} alt="Generated art" className="rounded-lg mx-auto shadow-lg max-w-full h-auto" /></div>}
                        {!isGeneratingImage && !generatedImage && taskResults[0] === false && <p className="text-yellow-400 mt-4">Ответ неверный, поэтому изображение не было сгенерировано.</p>}
                        {limitReached && !generatedImage && taskResults[0] && <p className="text-slate-500 text-sm mt-4">Вы ответили правильно, но, к сожалению, достигли дневного лимита генераций.</p>}
                    </div>
                )}
            </>
        );
    };

    const renderInteractiveTask = () => {
        if (!task) return null;

        const getContextDescription = () => {
            switch (task.type) {
                case 'dialogue': return <p className="text-slate-400 mb-2"><strong>Контекст:</strong> {task.context}</p>;
                case 'story': return (
                    <div className="text-slate-400 mb-2 space-y-1">
                        <p><strong>Задание:</strong> {task.content}</p>
                        <p><strong>Обязательные слова:</strong> <span className="font-mono text-indigo-300">{task.words?.join(', ')}</span></p>
                        <p><strong>Обязательная грамматика:</strong> <span className="text-indigo-300">{task.grammarConstraint}</span></p>
                    </div>);
                case 'editing': return (
                     <div className="space-y-4">
                        <p className="text-slate-400"><strong>Задание:</strong> {task.constraints}</p>
                        <div><p className="text-sm font-semibold text-slate-500">ИСХОДНЫЙ ТЕКСТ (НА РУССКОМ)</p><p className="text-slate-300 p-3 bg-slate-900/50 rounded-md mt-1">{task.originalText}</p></div>
                        <div><p className="text-sm font-semibold text-slate-500">"НЕСОВЕРШЕННЫЙ" ПЕРЕВОД (ДЛЯ РЕДАКТИРОВАНИЯ)</p><p className="text-slate-300 p-3 bg-slate-900/50 rounded-md mt-1">{task.content}</p></div>
                     </div>);
                default: return null;
            }
        }

        return (
            <div>
                <div className="mb-6">{getContextDescription()}</div>
                {task.type === 'dialogue' && (<div className="mb-4 p-3 border-l-4 border-indigo-500 bg-slate-900/50"><p className="font-semibold">Собеседник:</p><p className="text-slate-300 italic">"{task.content}"</p></div>)}
                <label htmlFor="user-input" className="block text-sm font-medium text-slate-300 mb-2">{task.type === 'editing' ? 'Ваш исправленный перевод:' : 'Ваш ответ:'}</label>
                <textarea id="user-input" value={userInput} onChange={(e) => setUserInput(e.target.value)} disabled={showResults} rows={task.type === 'story' ? 8 : 4} className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-70" placeholder="Напишите здесь..."/>
                {showResults && evaluation && (<div className={`mt-4 p-4 rounded-lg border ${evaluation.isCorrect ? 'bg-green-900/50 border-green-700' : 'bg-red-900/50 border-red-700'}`}><h4 className={`font-bold ${evaluation.isCorrect ? 'text-green-300' : 'text-red-300'}`}>{evaluation.isCorrect ? 'Отлично!' : 'Нужно поработать'}</h4><p className="text-slate-300 mt-1 whitespace-pre-wrap">{evaluation.feedback}</p></div>)}
            </div>
        )
    }
    
    const renderFeedbackSection = () => {
        if (!showResults) return null;
        
        if (feedbackSubmitted) {
            return <div className="mt-4 text-center text-green-400 font-semibold">Спасибо за ваш отзыв!</div>
        }
        
        if (showFeedbackForm) {
            return (
                <form onSubmit={handleFeedbackFormSubmit} className="mt-6 border-t border-slate-700 pt-6">
                    <label htmlFor="feedback-input" className="block text-sm font-medium text-slate-300 mb-2">Что вы думаете об этом задании? Ваш отзыв поможет сделать обучение лучше.</label>
                    <textarea 
                        id="feedback-input"
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        rows={3}
                        className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        placeholder="Например: 'Это было слишком легко' или 'Больше заданий на грамматику!'"
                    />
                    <div className="flex justify-end gap-2 mt-2">
                         <Button type="button" variant="ghost" onClick={() => setShowFeedbackForm(false)}>Отмена</Button>
                         <Button type="submit" variant="secondary" disabled={!feedbackText.trim()}>Отправить отзыв</Button>
                    </div>
                </form>
            );
        }
        
        return (
            <div className="mt-6 border-t border-slate-700 pt-6 flex justify-center">
                <Button variant="ghost" onClick={() => setShowFeedbackForm(true)}>Оставить отзыв о задании</Button>
            </div>
        )
    }

    const renderTask = () => {
        if (!task) return null;
        return (
            <Card className="w-full">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500">{task.title}</h2>
                    <span className="bg-slate-700 text-indigo-300 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full capitalize">{task.type}</span>
                </div>
                {isInteractiveTask ? renderInteractiveTask() : renderQuizTask()}
                <div className="mt-8 flex justify-end gap-4">
                    {showResults ? (<Button onClick={handleNextTask} isLoading={isLoading}>Новое задание</Button>) : (<Button onClick={handleCheckAnswers} isLoading={isChecking} disabled={isInteractiveTask ? !userInput.trim() : Object.keys(selectedAnswers).length !== (task.questions?.length ?? 0)}>Проверить</Button>)}
                </div>
                {renderFeedbackSection()}
            </Card>
        );
    };

    return (
        <div className="py-8">
            <header className="mb-8">
                 <ProgressTracker history={userData.taskHistory} />
                 {canAttemptLevelUp && (
                     <Card className="mt-4 text-center bg-indigo-900/50 border-indigo-700">
                        <h3 className="text-xl font-bold text-white">Поздравляем!</h3>
                        <p className="text-indigo-200 mt-2 mb-4">Вы достигли цели по правильным ответам. Готовы проверить свои знания и перейти на следующий уровень?</p>
                        <Button onClick={onStartLevelUpTest} variant="primary">Пройти тест на повышение</Button>
                     </Card>
                 )}
            </header>
            <main>
                {isLoading && <Loader text="Генерируем для вас задание..." />}
                {error && !isLoading && <Card className="text-center text-red-400">{error} <Button onClick={() => fetchTask(true)} variant='secondary' className='mt-4'>Попробовать снова</Button></Card>}
                {!isLoading && !error && task && renderTask()}
            </main>
        </div>
    );
};

export default LearningDashboard;