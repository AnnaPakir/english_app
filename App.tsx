import React, { useState, useCallback, useEffect } from 'react';
import { AppState, CEFRLevel, AssessmentQuestion, UserData } from './types.ts';
import { GeminiService } from './services/geminiService.ts';
import WelcomeScreen from './components/WelcomeScreen.tsx';
import Assessment from './components/Assessment.tsx';
import ResultsScreen from './components/ResultsScreen.tsx';
import LearningDashboard from './components/LearningDashboard.tsx';
import { Loader } from './components/common/Loader.tsx';
import { Card } from './components/common/Card.tsx';
import AuthScreen from './components/AuthScreen.tsx';
import Header from './components/Header.tsx';
import { CEFR_LEVELS_ORDER, LEVEL_UP_PASS_PERCENTAGE, PROGRESS_HISTORY_LENGTH } from './constants.ts';
import LevelUpAssessment from './components/LevelUpAssessment.tsx';
import LevelUpResultsScreen from './components/LevelUpResultsScreen.tsx';

const STORAGE_KEY = 'geminiEnglishTutorData';

const App: React.FC = () => {
    const [appState, setAppState] = useState<AppState>(AppState.AUTH);
    const [userData, setUserData] = useState<UserData | null>(null);
    const [geminiService, setGeminiService] = useState<GeminiService | null>(null);
    const [assessmentQuestions, setAssessmentQuestions] = useState<AssessmentQuestion[]>([]);
    const [levelUpQuestions, setLevelUpQuestions] = useState<AssessmentQuestion[]>([]);
    const [levelUpResult, setLevelUpResult] = useState<{isSuccess: boolean; newLevel: CEFRLevel | null}>({isSuccess: false, newLevel: null});
    const [error, setError] = useState<string | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);

    const getToday = () => new Date().toISOString().split('T')[0];

    useEffect(() => {
        try {
            const savedDataRaw = localStorage.getItem(STORAGE_KEY);
            if (savedDataRaw) {
                const savedData: UserData = JSON.parse(savedDataRaw);
                handleLogin(savedData.user.name, savedData.apiKey, true);
            }
        } catch (e) {
            console.error("Failed to load data from storage", e);
            localStorage.removeItem(STORAGE_KEY);
        } finally {
            setIsInitializing(false);
        }
    }, []);

    const handleUserDataChange = (newUserData: UserData) => {
        setUserData(newUserData);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newUserData));
    };

    const handleLogin = (name: string, apiKey: string, fromStorage = false) => {
        try {
            const service = new GeminiService(apiKey);
            setGeminiService(service);
            const today = getToday();
            let data: UserData;

            if (fromStorage) {
                const savedDataRaw = localStorage.getItem(STORAGE_KEY);
                data = JSON.parse(savedDataRaw!);
                
                // Backwards compatibility checks
                if (!data.taskHistory) data.taskHistory = [];
                if (!data.dailyStats || data.dailyStats.date !== today) {
                    data.dailyStats = { date: today, completed: 0, correct: 0 };
                }
                if (!data.imageGeneration || data.imageGeneration.date !== today) {
                    data.imageGeneration = { count: 0, date: today };
                }
                if (!data.feedbackHistory) data.feedbackHistory = [];
            } else {
                 data = {
                    user: {
                        name,
                        imageUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`
                    },
                    apiKey,
                    level: null,
                    imageGeneration: { count: 0, date: today },
                    taskHistory: [],
                    dailyStats: { date: today, completed: 0, correct: 0 },
                    feedbackHistory: [],
                };
            }
            handleUserDataChange(data);
            
            if (data.level) {
                setAppState(AppState.LEARNING);
            } else {
                setAppState(AppState.WELCOME);
            }
        } catch (err: any) {
            setError("Ошибка инициализации: " + err.message);
            setAppState(AppState.AUTH);
        }
    };

    const handleStartAssessment = useCallback(async () => {
        if (!geminiService) return;
        setAppState(AppState.ASSESSMENT_LOADING);
        setError(null);
        try {
            const questions = await geminiService.generateAssessmentTest();
            if (questions && questions.length > 0) {
                setAssessmentQuestions(questions);
                setAppState(AppState.ASSESSING);
            } else {
                throw new Error("Не удалось загрузить вопросы для теста.");
            }
        } catch (err: any) {
            setError(err.message || 'Произошла неизвестная ошибка.');
            setAppState(AppState.WELCOME); 
        }
    }, [geminiService]);

    const handleAssessmentComplete = (level: CEFRLevel) => {
        if (!userData) return;
        const newUserData = { ...userData, level };
        handleUserDataChange(newUserData);
        setAppState(AppState.RESULTS);
    };
    
    const handleStartLearning = () => {
        if (userData?.level) {
            setAppState(AppState.LEARNING);
        }
    };
    
    const handleReset = () => {
        localStorage.removeItem(STORAGE_KEY);
        setUserData(null);
        setGeminiService(null);
        setAssessmentQuestions([]);
        setLevelUpQuestions([]);
        setError(null);
        setAppState(AppState.AUTH);
    };

    const handleTaskComplete = (results: boolean[]) => {
        if (!userData) return;
        
        const correctCount = results.filter(Boolean).length;
        const totalCount = results.length;

        const newHistory = [...userData.taskHistory, ...results];
        if (newHistory.length > PROGRESS_HISTORY_LENGTH) {
            newHistory.splice(0, newHistory.length - PROGRESS_HISTORY_LENGTH);
        }

        const newDailyStats = { ...userData.dailyStats };
        newDailyStats.completed += totalCount;
        newDailyStats.correct += correctCount;

        handleUserDataChange({ ...userData, taskHistory: newHistory, dailyStats: newDailyStats });
    };

    const handleStartLevelUpTest = useCallback(async () => {
        if (!geminiService || !userData || !userData.level) return;
        
        const currentLevelIndex = CEFR_LEVELS_ORDER.indexOf(userData.level);
        if (currentLevelIndex >= CEFR_LEVELS_ORDER.length - 1) {
            alert("Поздравляем, вы достигли максимального уровня!");
            return;
        }
        
        const testLevel = userData.level;
        setAppState(AppState.LEVEL_UP_ASSESSMENT_LOADING);
        setError(null);

        try {
            const questions = await geminiService.generateLevelUpTest(testLevel);
            setLevelUpQuestions(questions);
            setAppState(AppState.LEVEL_UP_ASSESSING);
        } catch(err: any) {
            setError(err.message || 'Не удалось создать тест.');
            setAppState(AppState.LEARNING);
        }

    }, [geminiService, userData]);

    const handleLevelUpTestComplete = (score: number) => {
        if (!userData || !userData.level) return;

        const isSuccess = score >= LEVEL_UP_PASS_PERCENTAGE;
        const currentLevelIndex = CEFR_LEVELS_ORDER.indexOf(userData.level);
        const nextLevel = CEFR_LEVELS_ORDER[currentLevelIndex + 1];
        let newLevel = userData.level;

        if (isSuccess && nextLevel) {
            newLevel = nextLevel;
            setLevelUpResult({isSuccess: true, newLevel: newLevel});
        } else {
            setLevelUpResult({isSuccess: false, newLevel: null});
        }

        handleUserDataChange({ ...userData, level: newLevel, taskHistory: [] }); // Reset progress regardless of outcome
        setAppState(AppState.LEVEL_UP_RESULTS);
    };

    const handleContinueFromLevelUp = () => {
        setAppState(AppState.LEARNING);
        setLevelUpQuestions([]);
        setLevelUpResult({isSuccess: false, newLevel: null});
    }
    
    const handleFeedbackSubmit = (feedback: string) => {
        if (!userData) return;
        const newFeedbackHistory = [...userData.feedbackHistory, feedback];
        // Optional: limit the history size to keep it relevant
        if (newFeedbackHistory.length > 20) {
            newFeedbackHistory.shift();
        }
        handleUserDataChange({ ...userData, feedbackHistory: newFeedbackHistory });
    };

    const renderContent = () => {
        if (isInitializing) {
            return <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Загрузка приложения..." /></div>;
        }

        switch (appState) {
            case AppState.WELCOME:
                return userData && <><WelcomeScreen user={userData.user} onStart={handleStartAssessment} />{error && <div className="fixed bottom-5 right-5"><Card className="bg-red-500/20 border-red-500 text-red-300">{error}</Card></div>}</>;
            case AppState.ASSESSMENT_LOADING:
                return <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Готовим для вас тест..." /></div>;
            case AppState.ASSESSING:
                return <Assessment questions={assessmentQuestions} onComplete={handleAssessmentComplete} />;
            case AppState.RESULTS:
                return userData?.level && <ResultsScreen level={userData.level} onStartLearning={handleStartLearning} />;
            case AppState.LEARNING:
                return userData?.level && geminiService && (<LearningDashboard geminiService={geminiService} userData={userData} onUserDataChange={handleUserDataChange} onTaskComplete={handleTaskComplete} onStartLevelUpTest={handleStartLevelUpTest} onFeedbackSubmit={handleFeedbackSubmit} />);
            case AppState.LEVEL_UP_ASSESSMENT_LOADING:
                 return <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Готовим тест на повышение уровня..." /></div>;
            case AppState.LEVEL_UP_ASSESSING:
                return <LevelUpAssessment questions={levelUpQuestions} onComplete={handleLevelUpTestComplete} />;
            case AppState.LEVEL_UP_RESULTS:
                return <LevelUpResultsScreen isSuccess={levelUpResult.isSuccess} newLevel={levelUpResult.newLevel} onContinue={handleContinueFromLevelUp} />;
            case AppState.AUTH:
                 return <AuthScreen onLogin={(name, apiKey) => handleLogin(name, apiKey, false)} error={error} />;
            default:
                return null;
        }
    };

    if (isInitializing) {
        return <div className="bg-slate-900 min-h-screen flex items-center justify-center"><Loader text="Загрузка приложения..." /></div>
    }

    if (appState === AppState.AUTH) {
        return <AuthScreen onLogin={(name, apiKey) => handleLogin(name, apiKey, false)} error={error} />;
    }

    return (
        userData && (
            <div className="bg-slate-900 min-h-screen">
                <Header user={userData.user} onReset={handleReset} level={userData.level} dailyStats={userData.dailyStats}/>
                <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                    {renderContent()}
                </main>
            </div>
        )
    );
};

export default App;