
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { AppState, GoogleUser, UserData, CEFRLevel, AssessmentAnswer } from './types';
import { GeminiService } from './services/geminiService';

import { AuthScreen } from './components/AuthScreen';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AssessmentScreen } from './components/Assessment';
import { ResultsScreen } from './components/ResultsScreen';
import { LearningDashboard } from './components/LearningDashboard';
import { Header } from './components/Header';
import { Loader } from './components/common/Loader';
import { Card } from './components/common/Card';

declare global {
    interface Window {
        google: any;
    }
}

class LocalStorageService {
    storageKey: string | null;
    constructor(userEmail: string) {
        this.storageKey = userEmail ? `gemini-tutor-${userEmail}` : null;
    }

    isAvailable() {
        return !!this.storageKey;
    }

    async getData(): Promise<UserData | null> {
        if (!this.isAvailable()) return null;
        const rawData = localStorage.getItem(this.storageKey!);
        if (!rawData) {
            return null;
        }
        try {
            return JSON.parse(rawData);
        } catch (error) {
            console.error("Failed to parse user data from local storage. Clearing corrupted data.", error);
            localStorage.removeItem(this.storageKey!);
            return null;
        }
    }

    async saveData(data: UserData) {
        if (!this.isAvailable()) return;
        localStorage.setItem(this.storageKey!, JSON.stringify(data));
    }
}

const useUserData = (user: GoogleUser | null) => {
    const [userData, setUserData] = useState<UserData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const storageService = useMemo(() => user ? new LocalStorageService(user.email) : null, [user]);

    const loadData = useCallback(async () => {
        if (!storageService) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        const data = await storageService.getData();
        setUserData(data);
        setIsLoading(false);
    }, [storageService]);

    const saveData = useCallback(async (newData: UserData) => {
        if (!storageService) return;
        setUserData(newData);
        await storageService.saveData(newData);
    }, [storageService]);

    useEffect(() => {
        if (user) {
            loadData();
        } else {
            setUserData(null);
            setIsLoading(false);
        }
    }, [user, loadData]);
    
    return { userData, saveData, isLoading };
};


function App() {
    const [appState, setAppState] = useState<AppState>(AppState.AUTH);
    const [user, setUser] = useState<GoogleUser | null>(null);
    const [assessmentAnswers, setAssessmentAnswers] = useState<AssessmentAnswer[] | null>(null);
    const [level, setLevel] = useState<CEFRLevel | null>(null);
    const [error, setError] = useState<string | null>(null);

    const { userData, saveData, isLoading: isUserDataLoading } = useUserData(user);
    const gemini = useMemo(() => {
        try {
            return process.env.API_KEY ? new GeminiService(process.env.API_KEY) : null
        } catch(e: any) {
            setError(e.message);
            return null;
        }
    }, []);

    useEffect(() => {
        if (user && !isUserDataLoading) {
            if (userData) {
                setLevel(userData.level);
                setAppState(AppState.LEARNING);
            } else {
                setAppState(AppState.WELCOME);
            }
        }
    }, [user, userData, isUserDataLoading]);
    
    const handleAuth = (authedUser: GoogleUser) => {
        setUser(authedUser);
        setAppState(AppState.AUTH_LOADING);
    };

    const handleStartAssessment = () => setAppState(AppState.ASSESSING);

    const handleCompleteAssessment = (answers: AssessmentAnswer[]) => {
        setAssessmentAnswers(answers);
        setAppState(AppState.ASSESSMENT_LOADING);
    };
    
    const handleStartLearning = async () => {
        if (!level) return;
        const initialUserData: UserData = {
            level: level,
            vocabulary: [],
            taskHistory: [],
            tasksCompleted: 0,
            recentNewWords: []
        };
        await saveData(initialUserData);
        setAppState(AppState.LEARNING);
    };
    
    const handleSignOut = () => {
        setUser(null);
        setAppState(AppState.AUTH);
    };

    useEffect(() => {
        if (appState === AppState.ASSESSMENT_LOADING) {
            const evaluate = async () => {
                if (!gemini) {
                    setError("Gemini service is not initialized.");
                    setAppState(AppState.WELCOME);
                    return;
                }
                try {
                    const resultLevel = await gemini.evaluateInitialAssessment(assessmentAnswers!);
                    setLevel(resultLevel);
                    setAppState(AppState.RESULTS);
                } catch (err) {
                    console.error("Failed to evaluate assessment:", err);
                    setError("Could not evaluate your assessment. Please try again.");
                    setAppState(AppState.WELCOME);
                }
            };
            evaluate();
        }
    }, [appState, assessmentAnswers, gemini]);

    const renderContent = () => {
        if (!gemini || error) {
            return (
                 <div className="min-h-screen flex items-center justify-center fade-in">
                    <Card className="text-center">
                        <h1 className="text-2xl font-bold text-red-400">Configuration Error</h1>
                        <p className="text-gray-300 mt-2">{error || "API_KEY is not configured. Please set the API_KEY environment variable."}</p>
                    </Card>
                </div>
            );
        }

        switch (appState) {
            case AppState.AUTH:
                return <AuthScreen onAuth={handleAuth} />;
            case AppState.AUTH_LOADING:
                 return <Loader text="Loading..." />;
            case AppState.WELCOME:
                return <WelcomeScreen userName={user!.name} onStartAssessment={handleStartAssessment} />;
            case AppState.ASSESSING:
                return <AssessmentScreen gemini={gemini} onComplete={handleCompleteAssessment} />;
            case AppState.ASSESSMENT_LOADING:
                return <Loader text="Evaluating your answers..." />;
            case AppState.RESULTS:
                return <ResultsScreen level={level!} onStartLearning={handleStartLearning} />;
            case AppState.LEARNING:
                if (isUserDataLoading) return <Loader text="Loading your learning path..." />;
                if (!userData) return <Loader text="Initializing user data..." />
                return <LearningDashboard gemini={gemini} userData={userData} saveData={saveData} />;
            default:
                return <p>Error: Unknown application state.</p>;
        }
    };

    return (
        <main className="relative min-h-screen flex flex-col items-center justify-center p-4 pt-24 md:pt-4">
            <Header user={user} onSignOut={handleSignOut} />
            {renderContent()}
        </main>
    );
}

export default App;
