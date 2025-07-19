
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// Declare global window properties
declare global {
    interface Window {
        google: any;
        tokenClient: any;
    }
}

// --- Enums ---
enum CEFRLevel {
    A1 = "A1 (Beginner)",
    A2 = "A2 (Elementary)",
    B1 = "B1 (Intermediate)",
    B2 = "B2 (Upper-Intermediate)",
    C1 = "C1 (Advanced)",
}

enum AppState {
    AUTH,
    DRIVE_LOADING,
    API_KEY_SETUP,
    WELCOME,
    ASSESSING,
    ASSESSMENT_LOADING,
    RESULTS,
    LEARNING,
    ERROR,
}

// --- Interfaces ---
interface AssessmentQuestion {
    level: CEFRLevel;
    question: string;
    options: string[];
    correctAnswer: string;
}

interface AssessmentAnswer {
    question: string;
    answer: string;
    correctAnswer: string;
}

interface VocabularyWord {
    word: string;
    mastery: number;
}

interface UserData {
    level: CEFRLevel;
    vocabulary: VocabularyWord[];
    taskHistory: string[];
    tasksCompleted: number;
    recentNewWords: string[];
}

interface DriveData {
    apiKey: string | null;
    userData: UserData | null;
}

interface LearningTask {
    type: string;
    question: string;
    parts?: string[];
    augmentedParts?: { part: string, id: string }[];
    options?: string[];
    correctAnswer: string;
    correctSentence?: string;
    audioPrompt?: string;
    wordToLearn?: string;
    explanation: string;
}

interface GoogleUser {
    name: string;
    email: string;
    picture: string;
}

// --- Constants ---
const ALL_TASK_TYPES = [
    'Translate', 'FillInTheBlank', 'BuildSentence', 'Listen',
    'CorrectTheMistake', 'MultipleChoice', 'WordDefinition',
    'SynonymsAndAntonyms', 'MatchDefinition', 'OddOneOut', 'Categorization'
];

const GOOGLE_CLIENT_ID = "964856571599-1v6c6scu4l8leeoferjfhhrn0ftt4t3j.apps.googleusercontent.com";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const CEFR_LEVELS_ORDER = [CEFRLevel.A1, CEFRLevel.A2, CEFRLevel.B1, CEFRLevel.B2, CEFRLevel.C1];
const VOCABULARY_MASTERY_THRESHOLD = 15;
const LONG_TERM_TASK_HISTORY_LENGTH = 12;
const CONCURRENT_WORDS_TO_LEARN = 20;
const ASSESSMENT_QUESTIONS = 5;
const RECENTLY_INTRODUCED_WORDS_MEMORY = 5;

// --- Helper Functions ---
function shuffleArray<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

const findLeastRecentTask = (allTasks: string[], history: string[]) => {
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

// --- Services ---
class GeminiService {
    ai: GoogleGenAI;
    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("API key is required for GeminiService");
        }
        this.ai = new GoogleGenAI({ apiKey });
    }

     async getInitialAssessment(): Promise<AssessmentQuestion[]> {
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
        return assessment.map((q: AssessmentQuestion) => ({ ...q, options: shuffleArray(q.options) }));
    }

    async evaluateInitialAssessment(answers: AssessmentAnswer[]): Promise<CEFRLevel> {
        const schema = { type: Type.STRING, enum: Object.values(CEFRLevel) };
        const prompt = `Based on the following answers to an English assessment test, what is the user's CEFR level?
        The user's answers: ${JSON.stringify(answers)}
        Respond with only the CEFR level string (e.g., "B1 (Intermediate)").`;
        
        const response = await this.ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: schema },
        });

        try {
            const parsedText = JSON.parse(response.text);
            if (Object.values(CEFRLevel).includes(parsedText)) {
                return parsedText;
            } else {
                return CEFRLevel.A1;
            }
        } catch (e) {
            const rawText = response.text.trim();
            if (Object.values(CEFRLevel).includes(rawText as CEFRLevel)) {
                return rawText as CEFRLevel;
            }
            return CEFRLevel.A1;
        }
    }
    
    async generateLearningTask(userData: UserData): Promise<LearningTask> {
        const { level, vocabulary = [], taskHistory = [], tasksCompleted = 0, recentNewWords = [] } = userData;
        
        let forcedInstruction: string;

        if (tasksCompleted > 0 && tasksCompleted % 8 === 4) {
            const leastRecentTask = findLeastRecentTask(ALL_TASK_TYPES, taskHistory);
            forcedInstruction = `**PRIORITY**: Generate a '${leastRecentTask}' task. This task type was chosen to add variety to the learning session. For tasks like 'SynonymsAndAntonyms', 'MatchDefinition', 'OddOneOut', 'Categorization', please provide options for a multiple-choice format.`;
        }
        else if (tasksCompleted > 0 && tasksCompleted % 8 === 0 && vocabulary.length > 0) {
            const sortedVocab = [...vocabulary].sort((a, b) => a.mastery - b.mastery);
            const weakestWord = sortedVocab[0].word;
            forcedInstruction = `**PRIORITY**: Generate a task to practice the word '${weakestWord}'. Do NOT use the 'WordDefinition' type. Use a type like 'FillInTheBlank', 'Translate', or 'BuildSentence' involving this word.`;
        }
        else if (tasksCompleted > 0 && tasksCompleted % 3 === 0 && CONCURRENT_WORDS_TO_LEARN > vocabulary.length) {
             const wordsToExclude = vocabulary.map((v: VocabularyWord) => v.word).concat(recentNewWords);
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

        const vocabularyPrompt = vocabulary.map((v: VocabularyWord) => `${v.word} (mastery: ${v.mastery})`).join(', ') || 'None';
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

class GoogleDriveService {
    private accessToken: string;
    private readonly FILE_NAME = 'gemini-tutor-progress.json';
    private readonly DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
    private readonly DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';

    constructor(accessToken: string) {
        if (!accessToken) throw new Error("Access Token is required for GoogleDriveService");
        this.accessToken = accessToken;
    }

    private getHeaders(contentType = 'application/json') {
        return {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': contentType,
        };
    }

    private async findFile(): Promise<string | null> {
        const query = `name='${this.FILE_NAME}' and mimeType='application/json' and trashed=false`;
        const res = await fetch(`${this.DRIVE_API_URL}/files?q=${encodeURIComponent(query)}&spaces=drive`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw new Error('Failed to search for file in Google Drive.');
        const data = await res.json();
        return data.files.length > 0 ? data.files[0].id : null;
    }

    private async createFile(): Promise<string> {
        const metadata = {
            name: this.FILE_NAME,
            mimeType: 'application/json',
            description: 'User progress and API key for Gemini English Tutor',
        };
        const initialContent: DriveData = { apiKey: null, userData: null };
        
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([JSON.stringify(initialContent)], { type: 'application/json' }));

        const createRes = await fetch(`${this.DRIVE_UPLOAD_URL}/files?uploadType=multipart`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.accessToken}` },
            body: form
        });

        if (!createRes.ok) {
            const errorBody = await createRes.text();
            console.error('Google Drive file creation failed:', createRes.status, errorBody);
            throw new Error('Failed to create file in Google Drive.');
        }
        const data = await createRes.json();
        return data.id;
    }
    
    async findOrCreateFile(): Promise<string> {
        const fileId = await this.findFile();
        if (fileId) return fileId;
        return await this.createFile();
    }

    async getFileContent(fileId: string): Promise<DriveData> {
        const res = await fetch(`${this.DRIVE_API_URL}/files/${fileId}?alt=media`, {
            headers: this.getHeaders(),
        });
        if (!res.ok) throw new Error('Failed to get file content from Google Drive.');
        try {
            return await res.json();
        } catch (e) {
            console.error("Failed to parse file content, returning default.", e);
            return { apiKey: null, userData: null };
        }
    }

    async saveFileContent(fileId: string, content: DriveData): Promise<void> {
        await fetch(`${this.DRIVE_UPLOAD_URL}/files/${fileId}?uploadType=media`, {
            method: 'PATCH',
            headers: this.getHeaders('application/json'),
            body: JSON.stringify(content),
        });
    }
}


// --- React Components ---

// Common UI Components
interface CardProps {
    children: React.ReactNode;
    className?: string;
}
const Card: React.FC<CardProps> = ({ children, className = '' }) => (<div className={`bg-gray-900/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6 shadow-lg ${className}`}>{children}</div>);

interface ButtonProps {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
    disabled?: boolean;
    variant?: 'primary' | 'secondary';
    type?: 'button' | 'submit' | 'reset';
}
const Button: React.FC<ButtonProps> = ({ children, onClick, className = '', disabled = false, variant = 'primary', type = 'button' }) => {
    const baseClasses = 'px-6 py-3 font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
    const variantClasses = {
        primary: 'bg-indigo-500 hover:bg-indigo-600 text-white focus:ring-indigo-400',
        secondary: 'bg-gray-700 hover:bg-gray-600 text-gray-200 focus:ring-gray-500',
    };
    return (<button type={type} onClick={onClick} className={`${baseClasses} ${variantClasses[variant]} ${className}`} disabled={disabled}>{children}</button>);
};

interface LoaderProps {
    text: string;
}
const Loader: React.FC<LoaderProps> = ({ text }) => (<div className="flex flex-col items-center justify-center space-y-4"><div className="dot-flashing"></div><p className="text-gray-400">{text}</p></div>);

// Icon Components
const IconWrapper = ({ children, className = '' }: { children: React.ReactNode, className?: string }) => <div className={`flex-shrink-0 ${className}`}>{children}</div>;
const ArrowRightOnRectangleIcon = ({ className = "w-6 h-6" }: { className?: string }) => (<IconWrapper className={className}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-full h-full"><path fillRule="evenodd" d="M7.5 3.75A1.5 1.5 0 006 5.25v13.5a1.5 1.5 0 001.5 1.5h6a1.5 1.5 0 001.5-1.5V15a.75.75 0 011.5 0v3.75a3 3 0 01-3 3h-6a3 3 0 01-3-3V5.25a3 3 0 013-3h6a3 3 0 013 3V9A.75.75 0 0115 9V5.25a1.5 1.5 0 00-1.5-1.5h-6zm10.72 4.72a.75.75 0 011.06 0l3 3a.75.75 0 010 1.06l-3 3a.75.75 0 11-1.06-1.06l1.72-1.72H9a.75.75 0 010-1.5h10.94l-1.72-1.72a.75.75 0 010-1.06z" clipRule="evenodd" /></svg></IconWrapper>);
const CheckCircleIcon = () => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-green-400"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg></IconWrapper>);
const XCircleIcon = () => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-red-400"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" /></svg></IconWrapper>);
const SpeakerWaveIcon = ({ className = "w-6 h-6" }: { className?: string }) => (<IconWrapper className={className}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-full h-full"><path fillRule="evenodd" d="M.75 9.75a.75.75 0 01.75-.75h2.25c.414 0 .75.336.75.75v4.5c0 .414-.336.75-.75.75H1.5a.75.75 0 01-.75-.75V9.75zM6 8.25a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm3.75 0a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm3.75.75a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0V9zm3-1.5a.75.75 0 01.75.75v7.5a.75.75 0 01-1.5 0V8.25a.75.75 0 01.75-.75zm3.75-.75a.75.75 0 00-1.5 0v9a.75.75 0 001.5 0V6.75z" clipRule="evenodd" /></svg></IconWrapper>);

// Feature Components
interface HeaderProps {
    user: GoogleUser | null;
    onSignOut: () => void;
}
const Header: React.FC<HeaderProps> = ({ user, onSignOut }) => (
    <header className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center bg-gray-950/50 backdrop-blur-sm z-10">
        <h1 className="text-xl font-bold">Gemini Tutor</h1>
        <div className="flex items-center gap-4">
            {user && (
                <>
                    <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full" />
                    <div>
                        <p className="font-semibold">{user.name}</p>
                        <p className="text-sm text-gray-400">{user.email}</p>
                    </div>
                    <button type="button" onClick={onSignOut} className="text-gray-400 hover:text-white" aria-label="Sign out">
                       <ArrowRightOnRectangleIcon />
                    </button>
                </>
            )}
        </div>
    </header>
);

interface ApiKeySetupScreenProps {
    onKeySaved: (key: string) => void;
}
const ApiKeySetupScreen: React.FC<ApiKeySetupScreenProps> = ({ onKeySaved }) => {
    const [key, setKey] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (key.trim()) {
            onKeySaved(key.trim());
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center fade-in">
            <Card className="text-center max-w-lg">
                <h1 className="text-3xl font-bold mb-2">Gemini API Key Required</h1>
                <p className="text-gray-300 mb-6">
                   Please enter your Google Gemini API key. It will be stored securely in a private file on your Google Drive.
                </p>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <input
                        type="password"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder="Enter your API Key"
                        className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        autoComplete="off"
                    />
                    <Button type="submit" disabled={!key.trim()}>Save and Continue</Button>
                </form>
                 <p className="text-sm text-gray-500 mt-4">
                    You can get a free API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Google AI Studio</a>.
                </p>
            </Card>
        </div>
    );
};

interface AuthScreenProps {
    onSignIn: () => void;
}
const AuthScreen: React.FC<AuthScreenProps> = ({ onSignIn }) => {
    return (
        <div className="min-h-screen flex items-center justify-center fade-in">
            <Card className="text-center">
                <h1 className="text-3xl font-bold mb-2">Gemini English Tutor</h1>
                <p className="text-gray-400 mb-6">Your personal AI-powered language learning partner.</p>
                <p className="text-gray-400 mb-6">Sign in to sync your progress with Google Drive.</p>
                <Button onClick={onSignIn}>Sign In with Google</Button>
            </Card>
        </div>
    );
};

interface WelcomeScreenProps {
    userName: string;
    onStartAssessment: () => void;
}
const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ userName, onStartAssessment }) => (
    <div className="min-h-screen flex items-center justify-center fade-in">
        <Card className="text-center max-w-lg">
            <h1 className="text-3xl font-bold mb-2">Welcome, {userName}!</h1>
            <p className="text-gray-300 mb-6">To personalize your learning journey, let's start with a quick assessment to determine your English level.</p>
            <Button onClick={onStartAssessment}>Start Assessment</Button>
        </Card>
    </div>
);

interface AssessmentScreenProps {
    gemini: GeminiService;
    onComplete: (answers: AssessmentAnswer[]) => void;
}
const AssessmentScreen: React.FC<AssessmentScreenProps> = ({ gemini, onComplete }) => {
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
        const newAnswers: AssessmentAnswer[] = [...answers, { question: question.question, answer, correctAnswer: question.correctAnswer }];
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

interface ResultsScreenProps {
    level: CEFRLevel;
    onStartLearning: () => void;
}
const ResultsScreen: React.FC<ResultsScreenProps> = ({ level, onStartLearning }) => (
    <div className="min-h-screen flex items-center justify-center fade-in">
        <Card className="text-center">
            <h1 className="text-3xl font-bold mb-2">Assessment Complete!</h1>
            <p className="text-gray-400 mb-4">We've assessed your level as:</p>
            <p className="text-5xl font-bold text-indigo-400 mb-8">{level.split(' ')[0]}</p>
            <Button onClick={onStartLearning}>Start Learning</Button>
        </Card>
    </div>
);

interface TaskFeedbackProps {
    isCorrect: boolean;
    explanation: string;
    onNext: () => void;
}
const TaskFeedback: React.FC<TaskFeedbackProps> = ({ isCorrect, explanation, onNext }) => (
    <Card className="flex flex-col items-center space-y-4 text-center fade-in">
        {isCorrect ? <CheckCircleIcon /> : <XCircleIcon />}
        <h2 className={`text-2xl font-bold ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>{isCorrect ? "Correct!" : "Incorrect"}</h2>
        <p className="text-gray-300">{explanation}</p>
        <Button onClick={onNext} className="mt-4">Next Task</Button>
    </Card>
);

interface LearningDashboardProps {
    gemini: GeminiService;
    userData: UserData;
    saveUserData: (data: UserData) => Promise<void>;
}
const LearningDashboard: React.FC<LearningDashboardProps> = ({ gemini, userData, saveUserData }) => {
    const [task, setTask] = useState<LearningTask | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [answer, setAnswer] = useState('');
    const [feedback, setFeedback] = useState<{ isCorrect: boolean; explanation: string } | null>(null);
    const [builtSentenceParts, setBuiltSentenceParts] = useState<{ part: string; id: string }[]>([]);
    const [error, setError] = useState<string | null>(null);
    
    const fetchNextTask = useCallback(() => {
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
                setError("Could not generate a new task. Please try refreshing.");
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [gemini, userData]);

    useEffect(() => {
        fetchNextTask();
    }, [fetchNextTask]);


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
        if (!task || feedback === null) return;
        const newUserData = JSON.parse(JSON.stringify(userData));
        newUserData.tasksCompleted = (newUserData.tasksCompleted || 0) + 1;
        newUserData.taskHistory = [...(newUserData.taskHistory || []), task.type].slice(-LONG_TERM_TASK_HISTORY_LENGTH);
        const { wordToLearn } = task;
        if (wordToLearn) {
            let vocabulary: VocabularyWord[] = newUserData.vocabulary || [];
            const wordIndex = vocabulary.findIndex((v) => v.word.toLowerCase() === wordToLearn.toLowerCase());
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
        await saveUserData(newUserData);
        // After saving, the parent component will provide new props which triggers a re-render and fetches the next task.
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

    const isAnswerProvided = task.type === 'BuildSentence' 
        ? builtSentenceParts.length > 0 
        : (['MultipleChoice', 'SynonymsAndAntonyms', 'MatchDefinition', 'OddOneOut', 'Categorization'].includes(task.type) ? answer !== '' : answer.trim() !== '');

    return (
        <Card className="w-full max-w-2xl fade-in">
            <p className="text-sm font-medium text-indigo-400 mb-2">{task.type.replace(/([A-Z])/g, ' $1').trim()}</p>
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-4">
                {task.question}
                {task.audioPrompt && <button type="button" onClick={() => TextToSpeechService.speak(task.audioPrompt!)} aria-label="Listen to prompt"><SpeakerWaveIcon /></button>}
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

// --- Main App Component ---
function App() {
    const [appState, setAppState] = useState<AppState>(AppState.AUTH);
    const [user, setUser] = useState<GoogleUser | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [driveFileId, setDriveFileId] = useState<string | null>(null);
    const [driveData, setDriveData] = useState<DriveData | null>(null);
    const [gemini, setGemini] = useState<GeminiService | null>(null);
    const [assessmentAnswers, setAssessmentAnswers] = useState<AssessmentAnswer[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    
    // Auth and Data Loading Flow
    const handleAuthCallback = useCallback(async (tokenResponse: any) => {
        setAppState(AppState.DRIVE_LOADING);
        const token = tokenResponse.access_token;
        setAccessToken(token);

        try {
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!userInfoRes.ok) throw new Error('Failed to fetch user info.');
            const userInfo = await userInfoRes.json();
            setUser({ name: userInfo.name, email: userInfo.email, picture: userInfo.picture });

            const driveService = new GoogleDriveService(token);
            const fileId = await driveService.findOrCreateFile();
            setDriveFileId(fileId);

            const data = await driveService.getFileContent(fileId);
            setDriveData(data);
        } catch (e: any) {
            console.error("Auth or Drive error:", e);
            setError(`Authentication failed: ${e.message}`);
            setAppState(AppState.ERROR);
        }
    }, []);

    useEffect(() => {
        const initializeGsi = () => {
            if (window.google && window.google.accounts) {
                try {
                    window.tokenClient = window.google.accounts.oauth2.initTokenClient({
                        client_id: GOOGLE_CLIENT_ID,
                        scope: `${GOOGLE_DRIVE_SCOPE} https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile`,
                        callback: handleAuthCallback,
                        error_callback: (err: any) => {
                            console.error("Google Auth Error:", err);
                            setError("Google Authentication failed. Please try again.");
                            setAppState(AppState.ERROR);
                        }
                    });
                } catch (e) {
                    console.error("Failed to initialize Google Auth client", e);
                    setError("Could not set up Google Sign-In. Please refresh the page.");
                    setAppState(AppState.ERROR);
                }
            } else {
                // If the google object is not available, wait and try again.
                // This handles the race condition of the GSI script loading.
                setTimeout(initializeGsi, 100);
            }
        };
        initializeGsi();
    }, [handleAuthCallback]);

    useEffect(() => {
        if (!driveData) return;

        if (driveData.apiKey) {
            try {
                const geminiService = new GeminiService(driveData.apiKey);
                setGemini(geminiService);
                if (driveData.userData) {
                    setAppState(AppState.LEARNING);
                } else {
                    setAppState(AppState.WELCOME);
                }
            } catch (e: any) {
                setError(`Failed to initialize with stored API Key. It might be invalid. Please provide it again.`);
                setAppState(AppState.API_KEY_SETUP);
            }
        } else {
            setAppState(AppState.API_KEY_SETUP);
        }
    }, [driveData]);
    
    useEffect(() => {
        if (appState === AppState.ASSESSMENT_LOADING && assessmentAnswers && gemini) {
            const evaluate = async () => {
                try {
                    const resultLevel = await gemini.evaluateInitialAssessment(assessmentAnswers);
                    const initialUserData: UserData = {
                        level: resultLevel,
                        vocabulary: [],
                        taskHistory: [],
                        tasksCompleted: 0,
                        recentNewWords: []
                    };
                    await saveDriveData({ ...driveData!, userData: initialUserData });
                    setAppState(AppState.RESULTS);
                } catch (err) {
                    console.error("Failed to evaluate assessment:", err);
                    setError("Could not evaluate your assessment. The API key might be invalid.");
                    setAppState(AppState.ERROR);
                }
            };
            evaluate();
        }
    }, [appState, assessmentAnswers, gemini, driveData]);

    const saveDriveData = useCallback(async (newData: DriveData) => {
        if (!driveFileId || !accessToken) return;
        const driveService = new GoogleDriveService(accessToken);
        await driveService.saveFileContent(driveFileId, newData);
        setDriveData(newData);
    }, [accessToken, driveFileId]);

    const handleSignIn = () => {
        if (window.tokenClient) {
            window.tokenClient.requestAccessToken();
        } else {
            setError("Google Auth is not ready. Please refresh the page.");
            setAppState(AppState.ERROR);
        }
    };
    
    const handleKeySaved = async (key: string) => {
        await saveDriveData({ ...driveData!, apiKey: key });
    };

    const handleStartAssessment = () => setAppState(AppState.ASSESSING);
    
    const handleCompleteAssessment = (answers: AssessmentAnswer[]) => {
        setAssessmentAnswers(answers);
        setAppState(AppState.ASSESSMENT_LOADING);
    };

    const handleStartLearning = () => {
         if (driveData?.userData) {
            setAppState(AppState.LEARNING);
        } else {
            setError("Could not start learning session. User data not found.");
            setAppState(AppState.ERROR);
        }
    };

    const handleSaveUserData = async (newUserData: UserData) => {
        await saveDriveData({ ...driveData!, userData: newUserData });
    };

    const handleSignOut = () => {
        if (accessToken) {
            window.google.accounts.oauth2.revoke(accessToken, () => {});
        }
        setUser(null);
        setAccessToken(null);
        setDriveData(null);
        setDriveFileId(null);
        setGemini(null);
        setAppState(AppState.AUTH);
    };

    const renderContent = () => {
        switch (appState) {
            case AppState.AUTH:
                return <AuthScreen onSignIn={handleSignIn} />;
            case AppState.DRIVE_LOADING:
                return <Loader text="Connecting to Google Drive..." />;
            case AppState.API_KEY_SETUP:
                return <ApiKeySetupScreen onKeySaved={handleKeySaved} />;
            case AppState.WELCOME:
                if (!user) return <Loader text="Loading..." />;
                return <WelcomeScreen userName={user.name} onStartAssessment={handleStartAssessment} />;
            case AppState.ASSESSING:
                if (!gemini) return <Loader text="Initializing..." />;
                return <AssessmentScreen gemini={gemini} onComplete={handleCompleteAssessment} />;
            case AppState.ASSESSMENT_LOADING:
                return <Loader text="Evaluating your answers..." />;
            case AppState.RESULTS:
                if (!driveData?.userData?.level) return <Loader text="Loading results..." />;
                return <ResultsScreen level={driveData.userData.level} onStartLearning={handleStartLearning} />;
            case AppState.LEARNING:
                if (!gemini || !driveData?.userData) return <Loader text="Loading your learning path..." />;
                return <LearningDashboard gemini={gemini} userData={driveData.userData} saveUserData={handleSaveUserData} />;
            case AppState.ERROR:
                 return (
                    <Card className="text-center">
                        <h1 className="text-2xl font-bold text-red-400">Application Error</h1>
                        <p className="text-gray-300 mt-2">{error || "An unknown error occurred."}</p>
                        <Button onClick={() => window.location.reload()} className="mt-4">Refresh Page</Button>
                    </Card>
                );
            default:
                return <Loader text="Initializing..." />;
        }
    };
    
    return (
        <main className="relative min-h-screen flex flex-col items-center justify-center p-4 pt-24 md:pt-4 bg-gray-950 text-gray-100">
            <Header user={user} onSignOut={handleSignOut} />
            <div className="w-full max-w-3xl flex items-center justify-center">
                {renderContent()}
            </div>
        </main>
    );
}

// --- Final Render Call ---
const rootEl = document.getElementById('root');
if (rootEl) {
    const root = ReactDOM.createRoot(rootEl);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
} else {
    console.error("Fatal Error: Root element not found.");
}