
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

declare global {
    interface Window {
        google: any;
    }
}

// --- 1. Types & Enums ---
var CEFRLevel;
(function (CEFRLevel) {
    CEFRLevel["A1"] = "A1 (Beginner)";
    CEFRLevel["A2"] = "A2 (Elementary)";
    CEFRLevel["B1"] = "B1 (Intermediate)";
    CEFRLevel["B2"] = "B2 (Upper-Intermediate)";
    CEFRLevel["C1"] = "C1 (Advanced)";
})(CEFRLevel || (CEFRLevel = {}));

var AppState;
(function (AppState) {
    AppState[AppState["AUTH"] = 0] = "AUTH";
    AppState[AppState["AUTH_LOADING"] = 1] = "AUTH_LOADING";
    AppState[AppState["WELCOME"] = 2] = "WELCOME";
    AppState[AppState["ASSESSING"] = 3] = "ASSESSING";
    AppState[AppState["ASSESSMENT_LOADING"] = 4] = "ASSESSMENT_LOADING";
    AppState[AppState["RESULTS"] = 5] = "RESULTS";
    AppState[AppState["LEARNING"] = 6] = "LEARNING";
})(AppState || (AppState = {}));

const ALL_TASK_TYPES = [
    'Translate', 'FillInTheBlank', 'BuildSentence', 'Listen',
    'CorrectTheMistake', 'MultipleChoice', 'WordDefinition',
    'SynonymsAndAntonyms', 'MatchDefinition', 'OddOneOut', 'Categorization'
];

// --- 2. Constants ---
const GOOGLE_CLIENT_ID = "964856571599-1v6c6scu4l8leeoferjfhhrn0ftt4t3j.apps.googleusercontent.com";
const DRIVE_APP_FILE_NAME = 'gemini-english-tutor-data.json';
const CEFR_LEVELS_ORDER = [CEFRLevel.A1, CEFRLevel.A2, CEFRLevel.B1, CEFRLevel.B2, CEFRLevel.C1];
const VOCABULARY_MASTERY_THRESHOLD = 15;
const LONG_TERM_TASK_HISTORY_LENGTH = 12;
const CONCURRENT_WORDS_TO_LEARN = 20;
const ASSESSMENT_QUESTIONS = 5;
const RECENTLY_INTRODUCED_WORDS_MEMORY = 5;

// --- 3. Utility Functions ---
const shuffleArray = (array) => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

const findLeastRecentTask = (allTasks, history) => {
    let leastRecent = allTasks[0];
    let maxAge = -1;

    const shuffledTasks = shuffleArray(allTasks);

    for (const taskType of shuffledTasks) {
        if (taskType === 'WordDefinition') continue;

        const lastIndex = history.lastIndexOf(taskType);
        const age = lastIndex === -1 ? Infinity : history.length - 1 - lastIndex;

        if (age > maxAge) {
            maxAge = age;
            leastRecent = taskType;
        }
    }
    return leastRecent;
};


// --- 4. Icon Components ---
const IconWrapper = ({ children, className = '' }) => <div className={`flex-shrink-0 ${className}`}>{children}</div>;
const CheckCircleIcon = () => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-green-400"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg></IconWrapper>);
const XCircleIcon = () => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-red-400"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" /></svg></IconWrapper>);
const SpeakerWaveIcon = ({ className = "w-6 h-6" }) => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}><path fillRule="evenodd" d="M.75 9.75a.75.75 0 01.75-.75h2.25c.414 0 .75.336.75.75v4.5c0 .414-.336.75-.75.75H1.5a.75.75 0 01-.75-.75V9.75zM6 8.25a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm3.75 0a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm3.75.75a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0V9zm3-1.5a.75.75 0 01.75.75v7.5a.75.75 0 01-1.5 0V8.25a.75.75 0 01.75-.75zm3.75-.75a.75.75 0 00-1.5 0v9a.75.75 0 001.5 0V6.75z" clipRule="evenodd" /></svg></IconWrapper>);
const ArrowPathIcon = ({ className = "w-5 h-5" }) => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}><path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201-4.42 5.5 5.5 0 011.66-1.84l-.867-.868a.75.75 0 011.06-1.06l1.5 1.5a.75.75 0 010 1.06l-1.5 1.5a.75.75 0 11-1.06-1.06l.867-.867A4 4 0 1010 14.5a4 4 0 003.898-2.657.75.75 0 011.414.498A5.5 5.5 0 0115.312 11.424z" clipRule="evenodd" /></svg></IconWrapper>);
const UserCircleIcon = ({ className = "w-6 h-6" }) => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}><path fillRule="evenodd" d="M18.685 19.097A9.723 9.723 0 0021.75 12c0-5.385-4.365-9.75-9.75-9.75S2.25 6.615 2.25 12a9.723 9.723 0 003.065 7.097A9.716 9.716 0 0012 21.75a9.716 9.716 0 006.685-2.653zm-12.54-1.285A7.486 7.486 0 0112 15a7.486 7.486 0 016.155 2.812A8.224 8.224 0 0112 20.25a8.224 8.224 0 01-5.855-2.438zM15.75 9a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" clipRule="evenodd" /></svg></IconWrapper>);
const ArrowRightOnRectangleIcon = ({ className = "w-6 h-6" }) => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}><path fillRule="evenodd" d="M7.5 3.75A1.5 1.5 0 006 5.25v13.5a1.5 1.5 0 001.5 1.5h6a1.5 1.5 0 001.5-1.5V15a.75.75 0 011.5 0v3.75a3 3 0 01-3 3h-6a3 3 0 01-3-3V5.25a3 3 0 013-3h6a3 3 0 013 3V9A.75.75 0 0115 9V5.25a1.5 1.5 0 00-1.5-1.5h-6zm10.72 4.72a.75.75 0 011.06 0l3 3a.75.75 0 010 1.06l-3 3a.75.75 0 11-1.06-1.06l1.72-1.72H9a.75.75 0 010-1.5h10.94l-1.72-1.72a.75.75 0 010-1.06z" clipRule="evenodd" /></svg></IconWrapper>);


// --- 5. Services ---

class GeminiService {
    ai: GoogleGenAI;
    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("API key is required for GeminiService");
        }
        this.ai = new GoogleGenAI({ apiKey });
    }

    async getInitialAssessment() {
        const schema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    level: { type: Type.STRING, enum: Object.values(CEFRLevel) },
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctAnswer: { type: Type.STRING },
                },
                required: ['level', 'question', 'options', 'correctAnswer'],
            },
        };
        const response = await this.ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Generate ${ASSESSMENT_QUESTIONS} multiple-choice questions to assess a user's English level. The questions should range in difficulty from A1 to C1. Provide one question for each CEFR level.`,
            config: { responseMimeType: "application/json", responseSchema: schema },
        });

        const assessment = JSON.parse(response.text);
        return assessment.map(q => ({ ...q, options: shuffleArray(q.options) }));
    }

    async evaluateInitialAssessment(answers: any[]) {
        const schema = { type: Type.STRING, enum: Object.values(CEFRLevel) };
        const prompt = `Based on the following answers to an English assessment test, what is the user's CEFR level?
        The user's answers: ${JSON.stringify(answers)}
        Respond with only the CEFR level string (e.g., "B1 (Intermediate)").`;
        
        const response = await this.ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: schema },
        });

        return JSON.parse(response.text);
    }
    
    async generateLearningTask(userData: any) {
        const { level, vocabulary = [], taskHistory = [], tasksCompleted = 0, recentNewWords = [] } = userData;
        
        let forcedInstruction = null;

        // Rule 1a: Every 8 tasks (at cycle points like 4, 12, 20...), choose a task for variety
        if (tasksCompleted > 0 && tasksCompleted % 8 === 4) {
            const leastRecentTask = findLeastRecentTask(ALL_TASK_TYPES, taskHistory);
            forcedInstruction = `**PRIORITY**: Generate a '${leastRecentTask}' task. This task type was chosen to add variety to the learning session. For tasks like 'SynonymsAndAntonyms', 'MatchDefinition', 'OddOneOut', 'Categorization', please provide options for a multiple-choice format.`;
        }
        // Rule 1b: Every 8 tasks (at cycle points like 8, 16, 24...), practice the weakest word
        else if (tasksCompleted > 0 && tasksCompleted % 8 === 0 && vocabulary.length > 0) {
            const sortedVocab = [...vocabulary].sort((a, b) => a.mastery - b.mastery);
            const weakestWord = sortedVocab[0].word;
            forcedInstruction = `**PRIORITY**: Generate a task to practice the word '${weakestWord}'. Do NOT use the 'WordDefinition' type. Use a type like 'FillInTheBlank', 'Translate', or 'BuildSentence' involving this word.`;
        }
        // Rule 2: Every 3 tasks, try to add a new word if vocab is not full
        else if (tasksCompleted > 0 && tasksCompleted % 3 === 0 && vocabulary.length < CONCURRENT_WORDS_TO_LEARN) {
             const wordsToExclude = vocabulary.map(v => v.word).concat(recentNewWords);
             forcedInstruction = `**PRIORITY**: Generate a 'WordDefinition' task. The word should be new, relevant to the user's ${level}, and NOT in this list of words: ${JSON.stringify(wordsToExclude)}.`;
        } else {
             forcedInstruction = `Based on the user's profile, choose an optimal task type to help them improve. Avoid tasks from their recent history if possible. Good task types are: ${ALL_TASK_TYPES.join(', ')}. For new task types like 'SynonymsAndAntonyms', 'MatchDefinition', 'OddOneOut', 'Categorization', please provide options for a multiple-choice format.`;
        }

        const taskSchema = {
            type: Type.OBJECT,
            properties: {
                type: { type: Type.STRING, enum: ALL_TASK_TYPES },
                question: { type: Type.STRING },
                parts: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                options: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                correctAnswer: { type: Type.STRING },
                correctSentence: { type: Type.STRING, nullable: true },
                audioPrompt: { type: Type.STRING, nullable: true },
                wordToLearn: { type: Type.STRING, nullable: true },
                explanation: { type: Type.STRING },
            },
            required: ['type', 'question', 'correctAnswer', 'explanation']
        };

        const vocabularyPrompt = vocabulary.map(v => `${v.word} (mastery: ${v.mastery})`).join(', ') || 'None';
        const taskHistoryPrompt = taskHistory.slice(-5).join(', ') || 'None';

        const prompt = `
            You are an adaptive English tutor. Generate a personalized learning task for a user with the following profile:
            - CEFR Level: ${level}
            - Current Vocabulary being learned: ${vocabularyPrompt}
            - Recent Task History (last 5): ${taskHistoryPrompt}
            
            Instructions:
            ${forcedInstruction}

            The task should be challenging but achievable. For 'BuildSentence', provide the words/phrases in 'parts' in a shuffled order.
            For 'Listen', provide the text to be spoken in 'audioPrompt'.
            Ensure the response strictly adheres to the provided JSON schema.
        `;

        const response = await this.ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: taskSchema },
        });

        const task = JSON.parse(response.text);
        if (task.options) task.options = shuffleArray(task.options);
        if (task.parts) task.parts = shuffleArray(task.parts);
        return task;
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

    async getData() {
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

    async saveData(data: any) {
        if (!this.isAvailable()) return;
        localStorage.setItem(this.storageKey!, JSON.stringify(data));
    }
}

class TextToSpeechService {
    static speak(text) {
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

// --- 6. UI Components ---
const Button = ({ children, onClick, className = '', disabled = false, variant = 'primary' }) => {
    const baseClasses = 'px-6 py-3 font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
    const variantClasses = {
        primary: 'bg-indigo-500 hover:bg-indigo-600 text-white focus:ring-indigo-400',
        secondary: 'bg-gray-700 hover:bg-gray-600 text-gray-200 focus:ring-gray-500',
    };
    return (<button type="button" onClick={onClick} className={`${baseClasses} ${variantClasses[variant]} ${className}`} disabled={disabled}>{children}</button>);
};

const Card = ({ children, className = '' }) => (<div className={`bg-gray-900/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6 shadow-lg ${className}`}>{children}</div>);

const Loader = ({ text }) => (<div className="flex flex-col items-center justify-center space-y-4"><div className="dot-flashing"></div><p className="text-gray-400">{text}</p></div>);

const TaskFeedback = ({ isCorrect, explanation, onNext }) => (
    <Card className="flex flex-col items-center space-y-4 text-center fade-in">
        {isCorrect ? <CheckCircleIcon /> : <XCircleIcon />}
        <h2 className={`text-2xl font-bold ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>{isCorrect ? "Correct!" : "Incorrect"}</h2>
        <p className="text-gray-300">{explanation}</p>
        <Button onClick={onNext} className="mt-4">Next Task</Button>
    </Card>
);

// --- 7. Hooks ---
const useAuth = () => {
    const [user, setUser] = useState(null);

    const handleCredentialResponse = useCallback((response) => {
        const decoded = JSON.parse(atob(response.credential.split('.')[1]));
        setUser({
            name: decoded.name,
            email: decoded.email,
            picture: decoded.picture
        });
    }, []);

    const handleSignOut = useCallback(() => {
        setUser(null);
        // In a real app, you would also revoke the token.
    }, []);

    useEffect(() => {
        if (window.google?.accounts?.id) {
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleCredentialResponse,
            });
        }
    }, [handleCredentialResponse]);

    const renderGoogleButton = useCallback((ref) => {
        if (window.google?.accounts?.id && ref.current) {
             window.google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large" });
        }
    }, []);

    return { user, handleSignOut, renderGoogleButton };
};

const useUserData = (user) => {
    const [userData, setUserData] = useState(null);
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

    const saveData = useCallback(async (newData) => {
        if (!storageService) return;
        setUserData(newData);
        await storageService.saveData(newData);
    }, [storageService]);

    useEffect(() => {
        loadData();
    }, [loadData]);
    
    return { userData, saveData, isLoading };
};

// --- 8. Screen Components ---
const AuthScreen = ({ onAuth }) => {
    const googleButtonRef = useRef(null);
    const auth = useAuth();
    
    useEffect(() => {
        const interval = setInterval(() => {
            if (googleButtonRef.current && window.google?.accounts?.id && googleButtonRef.current.childElementCount === 0) {
                 auth.renderGoogleButton(googleButtonRef);
                 clearInterval(interval);
            }
        }, 100);
        return () => clearInterval(interval);
    }, [auth]);

    useEffect(() => {
        if (auth.user) {
            onAuth(auth.user);
        }
    }, [auth.user, onAuth]);

    return (
        <div className="min-h-screen flex items-center justify-center fade-in">
            <Card className="text-center">
                <h1 className="text-3xl font-bold mb-2">Gemini English Tutor</h1>
                <p className="text-gray-400 mb-6">Your personal AI-powered language learning partner.</p>
                <div ref={googleButtonRef}></div>
            </Card>
        </div>
    );
};

const WelcomeScreen = ({ userName, onStartAssessment }) => (
    <div className="min-h-screen flex items-center justify-center fade-in">
        <Card className="text-center max-w-lg">
            <h1 className="text-3xl font-bold mb-2">Welcome, {userName}!</h1>
            <p className="text-gray-300 mb-6">To personalize your learning journey, let's start with a quick assessment to determine your English level.</p>
            <Button onClick={onStartAssessment}>Start Assessment</Button>
        </Card>
    </div>
);

const AssessmentScreen = ({ gemini, onComplete }) => {
    const [questions, setQuestions] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

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

    const handleAnswer = (answer, question) => {
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

const ResultsScreen = ({ level, onStartLearning }) => (
    <div className="min-h-screen flex items-center justify-center fade-in">
        <Card className="text-center">
            <h1 className="text-3xl font-bold mb-2">Assessment Complete!</h1>
            <p className="text-gray-400 mb-4">We've assessed your level as:</p>
            <p className="text-5xl font-bold text-indigo-400 mb-8">{level.split(' ')[0]}</p>
            <Button onClick={onStartLearning}>Start Learning</Button>
        </Card>
    </div>
);

const LearningDashboard = ({ gemini, userData, saveData }) => {
    const [task, setTask] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [answer, setAnswer] = useState('');
    const [feedback, setFeedback] = useState(null);
    const [builtSentenceParts, setBuiltSentenceParts] = useState([]);
    const [error, setError] = useState(null);

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
        let isCorrect = false;
        let userAnswer = answer.trim();

        if (task.type === 'BuildSentence') {
            userAnswer = builtSentenceParts.map(p => p.part).join(' ');
        }
        
        const normalize = (str) => str.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g,"").replace(/\s+/g, ' ').trim();
        isCorrect = normalize(userAnswer) === normalize(task.correctAnswer);
        
        const explanation = isCorrect ? task.explanation : `${task.explanation} The correct answer was: "${task.correctAnswer}"`;
        setFeedback({ isCorrect, explanation });
    };
    
    const handleNext = async () => {
        const newUserData = JSON.parse(JSON.stringify(userData));

        newUserData.tasksCompleted = (newUserData.tasksCompleted || 0) + 1;
        newUserData.taskHistory = [...(newUserData.taskHistory || []), task.type].slice(-LONG_TERM_TASK_HISTORY_LENGTH);

        const { wordToLearn } = task;
        
        // This logic now correctly handles 'wordToLearn' which might not be present in every task.
        if (wordToLearn) {
            let vocabulary = newUserData.vocabulary || [];
            const wordIndex = vocabulary.findIndex(v => v.word.toLowerCase() === wordToLearn.toLowerCase());

            if (wordIndex !== -1) { // Word is being tracked
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
            } else if (task.type === 'WordDefinition' && feedback.isCorrect) { // Only add new words if the definition was seen and answered correctly.
                vocabulary.push({ word: wordToLearn, mastery: 1 });
                newUserData.vocabulary = vocabulary;

                const recentWords = (newUserData.recentNewWords || []).slice(-RECENTLY_INTRODUCED_WORDS_MEMORY + 1);
                recentWords.push(wordToLearn);
                newUserData.recentNewWords = recentWords;
            }
        }

        await saveData(newUserData);
        // This will trigger the useEffect to fetch a new task.
    };


    const renderTaskInput = () => {
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
            case 'WordDefinition': // No input needed for definition, just proceed.
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

const Header = ({ user, onSignOut }) => (
    <header className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center bg-gray-950/50 backdrop-blur-sm z-10">
        <h1 className="text-xl font-bold">Gemini Tutor</h1>
        {user && (
            <div className="flex items-center gap-4">
                 <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full" />
                <div>
                    <p className="font-semibold">{user.name}</p>
                    <p className="text-sm text-gray-400">{user.email}</p>
                </div>
                <button type="button" onClick={onSignOut} className="text-gray-400 hover:text-white" aria-label="Sign out">
                   <ArrowRightOnRectangleIcon />
                </button>
            </div>
        )}
    </header>
);

// --- 9. Main App Component ---
function App() {
    const [appState, setAppState] = useState(AppState.AUTH);
    const [user, setUser] = useState(null);
    const [assessmentAnswers, setAssessmentAnswers] = useState(null);
    const [level, setLevel] = useState(null);
    const [error, setError] = useState(null);

    const { userData, saveData, isLoading: isUserDataLoading } = useUserData(user);
    const gemini = useMemo(() => {
        try {
            return process.env.API_KEY ? new GeminiService(process.env.API_KEY) : null
        } catch(e) {
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
    
    const handleAuth = (authedUser) => {
        setUser(authedUser);
        setAppState(AppState.AUTH_LOADING);
    };

    const handleStartAssessment = () => setAppState(AppState.ASSESSING);

    const handleCompleteAssessment = (answers) => {
        setAssessmentAnswers(answers);
        setAppState(AppState.ASSESSMENT_LOADING);
    };
    
    const handleStartLearning = async () => {
        const initialUserData = {
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
                    const resultLevel = await gemini.evaluateInitialAssessment(assessmentAnswers);
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
                return <WelcomeScreen userName={user.name} onStartAssessment={handleStartAssessment} />;
            case AppState.ASSESSING:
                return <AssessmentScreen gemini={gemini} onComplete={handleCompleteAssessment} />;
            case AppState.ASSESSMENT_LOADING:
                return <Loader text="Evaluating your answers..." />;
            case AppState.RESULTS:
                return <ResultsScreen level={level} onStartLearning={handleStartLearning} />;
            case AppState.LEARNING:
                if (isUserDataLoading) return <Loader text="Loading your learning path..." />;
                if (!userData) return <Loader text="Initializing user data..." />
                return <LearningDashboard gemini={gemini} userData={userData} saveData={saveData} />;
            default:
                return <p>Error: Unknown application state.</p>;
        }
    };

    return (
        <React.StrictMode>
            <main className="relative min-h-screen flex flex-col items-center justify-center p-4 pt-24 md:pt-4">
                <Header user={user} onSignOut={handleSignOut} />
                {renderContent()}
            </main>
        </React.StrictMode>
    );
}

const rootEl = document.getElementById('root');
if (rootEl) {
    const root = ReactDOM.createRoot(rootEl);
    root.render(<App />);
} else {
    console.error("Fatal Error: Root element not found.");
}