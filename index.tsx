
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
    LEVEL_UP_PROMPT,
    LEVEL_UP_ASSESSMENT,
    LEVEL_UP_ASSESSMENT_LOADING,
    LEVEL_UP_RESULTS,
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
    tasksToday: number;
    lastSessionDate: string; // ISO date string e.g., "2023-10-27"
    recentPerformance: boolean[]; // track last 100 answers
    isPreparingForLevelUp: boolean;
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
const INITIAL_ASSESSMENT_QUESTIONS = 30;
const RECENTLY_INTRODUCED_WORDS_MEMORY = 5;

const LEVEL_UP_ASSESSMENT_QUESTIONS = 15;
const PERFORMANCE_TRACKING_WINDOW = 100;
const PREPARATION_MODE_THRESHOLD = 50;
const LEVEL_UP_THRESHOLD = 90;
const LEVEL_UP_PASS_PERCENTAGE = 0.7; // 70% to pass

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

const getTodayDateString = () => new Date().toISOString().split('T')[0];

const getNextLevel = (currentLevel: CEFRLevel): CEFRLevel | null => {
    const currentIndex = CEFR_LEVELS_ORDER.indexOf(currentLevel);
    if (currentIndex === -1 || currentIndex === CEFR_LEVELS_ORDER.length - 1) {
        return null;
    }
    return CEFR_LEVELS_ORDER[currentIndex + 1];
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
            contents: `Generate ${INITIAL_ASSESSMENT_QUESTIONS} multiple-choice questions to assess a user's English level. The questions should cover a wide range of difficulties from A1 to C1. Distribute the questions across the levels.`,
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
        const { level, vocabulary = [], taskHistory = [], tasksCompleted = 0, recentNewWords = [], isPreparingForLevelUp } = userData;
        
        let forcedInstruction: string;
        
        const difficultyInstruction = isPreparingForLevelUp
            ? "The user is preparing for a level-up test. Generate a challenging task, possibly slightly above their current level, to test their limits."
            : "The task should be challenging but achievable for the user's current level.";


        if (tasksCompleted > 0 && tasksCompleted % 8 === 4) {
            const leastRecentTask = findLeastRecentTask(ALL_TASK_TYPES, taskHistory);
            forcedInstruction = `**PRIORITY**: Generate a '${leastRecentTask}' task. This task type was chosen to add variety to the learning session. For tasks like 'SynonymsAndAntonyms', 'MatchDefinition', 'OddOneOut', 'Categorization', please provide options for a multiple-choice format. ${difficultyInstruction}`;
        }
        else if (tasksCompleted > 0 && tasksCompleted % 8 === 0 && vocabulary.length > 0) {
            const sortedVocab = [...vocabulary].sort((a, b) => a.mastery - b.mastery);
            const weakestWord = sortedVocab[0].word;
            forcedInstruction = `**PRIORITY**: Generate a task to practice the word '${weakestWord}'. Do NOT use the 'WordDefinition' type. Use a type like 'FillInTheBlank', 'Translate', or 'BuildSentence' involving this word. ${difficultyInstruction}`;
        }
        else if (tasksCompleted > 0 && tasksCompleted % 3 === 0 && CONCURRENT_WORDS_TO_LEARN > vocabulary.length) {
             const wordsToExclude = vocabulary.map((v: VocabularyWord) => v.word).concat(recentNewWords);
             forcedInstruction = `**PRIORITY**: Generate a 'WordDefinition' task. The word should be new, relevant to the user's ${level}, and NOT in this list of words: ${JSON.stringify(wordsToExclude)}.`;
        } else {
             forcedInstruction = `Based on the user's profile, choose an optimal task type to help them improve. Avoid tasks from their recent history if possible. Good task types are: ${ALL_TASK_TYPES.join(', ')}. For new task types like 'SynonymsAndAntonyms', 'MatchDefinition', 'OddOneOut', 'Categorization', please provide options for a multiple-choice format. ${difficultyInstruction}`;
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
            - Is Preparing For Level Up: ${isPreparingForLevelUp}
            
            Instructions:
            ${forcedInstruction}

            For 'BuildSentence', provide the words/phrases in 'parts' in a shuffled order. For 'Listen', provide the text to be spoken in 'audioPrompt'. Ensure the response strictly adheres to the provided JSON schema.
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
    
     async generateLevelUpAssessment(currentLevel: CEFRLevel): Promise<AssessmentQuestion[]> {
        const nextLevel = getNextLevel(currentLevel);
        if (!nextLevel) {
            // Fallback for C1 users, give them a very hard C1 test
            const fallbackPrompt = `Generate a very challenging ${LEVEL_UP_ASSESSMENT_QUESTIONS}-question C1 level English test.`;
             const response = await this.ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: fallbackPrompt,
                 config: { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: {
                    type: Type.OBJECT,
                    properties: {
                        level: { type: Type.STRING },
                        question: { type: Type.STRING },
                        options: { type: Type.ARRAY, items: { type: Type.STRING } },
                        correctAnswer: { type: Type.STRING },
                    },
                    required: ['level', 'question', 'options', 'correctAnswer'],
                }}},
            });
            return JSON.parse(response.text);
        }

        const schema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    level: { type: Type.STRING, enum: [nextLevel] },
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctAnswer: { type: Type.STRING },
                },
                required: ['level', 'question', 'options', 'correctAnswer'],
            },
        };

        const response = await this.ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Generate a difficult ${LEVEL_UP_ASSESSMENT_QUESTIONS}-question multiple-choice test to see if a user is ready to advance from ${currentLevel} to ${nextLevel}. All questions must be at the ${nextLevel} level.`,
            config: { responseMimeType: "application/json", responseSchema: schema },
        });

        const assessment = JSON.parse(response.text);
        return assessment.map((q: AssessmentQuestion) => ({ ...q, options: shuffleArray(q.options) }));
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
    onClick?: (e: React.MouseEvent) => void;
}
const Card: React.FC<CardProps> = ({ children, className = '', onClick }) => (<div onClick={onClick} className={`bg-gray-900/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6 shadow-lg ${className}`}>{children}</div>);

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
const SpeakerWaveIcon = ({ className = "w-6 h-6" }: { className?: string }) => (<IconWrapper className={className}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-full h-full"><path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.66 1.905H6.44l4.5 4.5c.944.945 2.56.276 2.56-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" /><path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" /></svg></IconWrapper>);
const StarIcon = ({ className = "w-5 h-5" }: { className?: string }) => (<IconWrapper className={className}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10.868 2.884c.321-.662 1.215-.662 1.536 0l1.83 3.751 4.144.604c.73.107 1.022.992.494 1.503l-2.998 2.922.708 4.127c.126.726-.638 1.28-1.296.938L10 15.122l-3.716 1.954c-.658.342-1.422-.212-1.296-.938l.708-4.127-2.998-2.922c-.528-.511-.236-1.396.494-1.503l4.144-.604 1.83-3.751z" clipRule="evenodd" /></svg></IconWrapper>);
const BookOpenIcon = ({ className = "w-6 h-6" }: { className?: string }) => (<IconWrapper className={className}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.522c0 .318.22.6.512.688a9.735 9.735 0 003.238.555A9.735 9.735 0 0012 21a9.735 9.735 0 005.75-1.445.75.75 0 00.512-.688V4.26a.75.75 0 00-.5-.707A9.707 9.707 0 0012.75 3a9.735 9.735 0 00-1.5-.033zM12.75 4.616a8.235 8.235 0 011.5.033c1.065 0 2.083.18 3 .502v12.698a8.235 8.235 0 01-3-.502 8.235 8.235 0 01-1.5-.033V4.616zM11.25 4.616V19.4a8.235 8.235 0 01-1.5.033c-1.065 0-2.083-.18-3-.502V5.118a8.235 8.235 0 013 .502c.496.118 1.01.173 1.5.178z" /></svg></IconWrapper>);


// Feature Components
interface HeaderProps {
    user: GoogleUser | null;
    onSignOut: () => void;
    tasksToday: number;
    onToggleVocabulary: () => void;
}
const Header: React.FC<HeaderProps> = ({ user, onSignOut, tasksToday, onToggleVocabulary }) => (
    <header className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center bg-gray-950/50 backdrop-blur-sm z-10">
        <h1 className="text-xl font-bold">Gemini Tutor</h1>
        <div className="flex items-center gap-4">
            {user && (
                <>
                    <div className="flex items-center gap-2 text-amber-400">
                       <StarIcon />
                       <span className="font-bold text-lg">{tasksToday}</span>
                       <span className="text-sm text-gray-400">/ day</span>
                    </div>
                    <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full" />
                    <div>
                        <p className="font-semibold">{user.name}</p>
                        <p className="text-sm text-gray-400">{user.email}</p>
                    </div>
                     <button type="button" onClick={onToggleVocabulary} className="text-gray-400 hover:text-white" aria-label="Open vocabulary">
                        <BookOpenIcon />
                    </button>
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
        if (key.trim()) onKeySaved(key.trim());
    };

    return (
        <div className="min-h-screen flex items-center justify-center fade-in">
            <Card className="text-center max-w-lg">
                <h1 className="text-3xl font-bold mb-2">Gemini API Key Required</h1>
                <p className="text-gray-300 mb-6">Please enter your Google Gemini API key. It will be stored securely in a private file on your Google Drive.</p>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Enter your API Key" className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" autoComplete="off"/>
                    <Button type="submit" disabled={!key.trim()}>Save and Continue</Button>
                </form>
                 <p className="text-sm text-gray-500 mt-4">You can get a free API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Google AI Studio</a>.</p>
            </Card>
        </div>
    );
};

interface AuthScreenProps {
    onSignIn: () => void;
}
const AuthScreen: React.FC<AuthScreenProps> = ({ onSignIn }) => (
    <div className="min-h-screen flex items-center justify-center fade-in">
        <Card className="text-center">
            <h1 className="text-3xl font-bold mb-2">Gemini English Tutor</h1>
            <p className="text-gray-400 mb-6">Your personal AI-powered language learning partner.</p>
            <p className="text-gray-400 mb-6">Sign in to sync your progress with Google Drive.</p>
            <Button onClick={onSignIn}>Sign In with Google</Button>
        </Card>
    </div>
);

interface WelcomeScreenProps {
    userName: string;
    onStartAssessment: () => void;
}
const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ userName, onStartAssessment }) => (
    <div className="min-h-screen flex items-center justify-center fade-in">
        <Card className="text-center max-w-lg">
            <h1 className="text-3xl font-bold mb-2">Welcome, {userName}!</h1>
            <p className="text-gray-300 mb-6">To personalize your learning journey, let's start with a comprehensive assessment ({INITIAL_ASSESSMENT_QUESTIONS} questions) to determine your English level.</p>
            <Button onClick={onStartAssessment}>Start Assessment</Button>
        </Card>
    </div>
);

interface AssessmentScreenProps {
    gemini: GeminiService;
    onComplete: (answers: AssessmentAnswer[]) => void;
    questionCount: number;
    assessmentType: 'initial' | 'levelup';
    levelToTest?: CEFRLevel;
}
const AssessmentScreen: React.FC<AssessmentScreenProps> = ({ gemini, onComplete, questionCount, assessmentType, levelToTest }) => {
    const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [answers, setAnswers] = useState<AssessmentAnswer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchAssessment = async () => {
            try {
                const fetchedQuestions = assessmentType === 'levelup' && levelToTest 
                    ? await gemini.generateLevelUpAssessment(levelToTest)
                    : await gemini.getInitialAssessment();
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
    }, [gemini, assessmentType, levelToTest]);

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
    const progress = Math.round(((currentQuestionIndex + 1) / questions.length) * 100);
    return (
        <div className="min-h-screen flex items-center justify-center fade-in w-full">
            <Card className="w-full max-w-2xl">
                <div className="w-full bg-gray-700 rounded-full h-2.5 mb-4">
                  <div className="bg-indigo-500 h-2.5 rounded-full" style={{ width: `${progress}%`, transition: 'width 0.3s ease-in-out' }}></div>
                </div>
                <p className="text-sm text-gray-400 mb-2">Question {currentQuestionIndex + 1} of {questions.length}</p>
                <h2 className="text-2xl font-semibold mb-6 flex items-center justify-between">
                    <span>{question.question}</span>
                    <button type="button" onClick={() => TextToSpeechService.speak(question.question)} className="text-gray-400 hover:text-white ml-4 flex-shrink-0" aria-label="Listen to question">
                        <SpeakerWaveIcon />
                    </button>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {question.options.map((option, i) => (
                        <div key={i} onClick={() => handleAnswer(option, question)} className="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-indigo-500 rounded-lg transition-colors cursor-pointer">
                            <span className="text-left flex-grow mr-2">{option}</span>
                            <button type="button" onClick={(e) => { e.stopPropagation(); TextToSpeechService.speak(option); }} className="text-gray-400 hover:text-white flex-shrink-0 p-1 rounded-full hover:bg-gray-700" aria-label={`Listen to option`}>
                                <SpeakerWaveIcon className="w-5 h-5" />
                            </button>
                        </div>
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
    correctAnswer: string | null;
    onNext: () => void;
}
const TaskFeedback: React.FC<TaskFeedbackProps> = ({ isCorrect, explanation, correctAnswer, onNext }) => (
    <Card className="flex flex-col items-center space-y-4 text-center fade-in w-full max-w-2xl">
        {isCorrect ? <CheckCircleIcon /> : <XCircleIcon />}
        <h2 className={`text-2xl font-bold ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>{isCorrect ? "Correct!" : "Incorrect"}</h2>
        
        <div className="w-full text-center space-y-4">
            <div className="flex justify-center items-center gap-2">
                <p className="text-gray-300">{explanation}</p>
                <button type="button" onClick={() => TextToSpeechService.speak(explanation)} className="text-gray-400 hover:text-white" aria-label="Listen to explanation">
                    <SpeakerWaveIcon className="w-5 h-5"/>
                </button>
            </div>

            {!isCorrect && correctAnswer && (
                <div className="bg-gray-800 p-3 rounded-lg text-left w-full">
                    <p className="text-gray-400 mb-1">The correct answer was:</p>
                    <div className="flex justify-between items-center">
                        <p className="font-semibold text-white">"{correctAnswer}"</p>
                         <button type="button" onClick={() => TextToSpeechService.speak(correctAnswer)} className="text-gray-400 hover:text-white" aria-label="Listen to correct answer">
                            <SpeakerWaveIcon />
                        </button>
                    </div>
                </div>
            )}
        </div>

        <Button onClick={onNext} className="mt-4">Next Task</Button>
    </Card>
);

interface ProgressTrackerProps {
    performance: boolean[];
}
const ProgressTracker: React.FC<ProgressTrackerProps> = ({ performance }) => {
    const correctCount = performance.filter(p => p).length;
    const totalCount = performance.length;
    const percentage = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
    
    let message = "Keep going to see your progress!";
    if (totalCount > 10) {
        if (percentage >= 90) message = "Incredible! You're ready for a new challenge!";
        else if (percentage >= 75) message = "Excellent work! Almost at the next level.";
        else if (percentage >= 50) message = "Great job! You're making solid progress.";
        else message = "You've got this! Every task is a step forward.";
    }

    return (
        <Card className="w-full mt-6 text-center">
            <h3 className="font-semibold text-lg">Recent Performance</h3>
            <p className="text-3xl font-bold text-indigo-400 my-2">{correctCount} / {Math.min(totalCount, PERFORMANCE_TRACKING_WINDOW)}</p>
            <p className="text-sm text-gray-400">{message}</p>
        </Card>
    );
};


interface LearningDashboardProps {
    gemini: GeminiService;
    userData: UserData;
    saveUserData: (data: UserData) => Promise<void>;
    triggerLevelUp: () => void;
}
const LearningDashboard: React.FC<LearningDashboardProps> = ({ gemini, userData, saveUserData, triggerLevelUp }) => {
    const [task, setTask] = useState<LearningTask | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [answer, setAnswer] = useState('');
    const [feedback, setFeedback] = useState<{ isCorrect: boolean; explanation: string; correctAnswer: string | null } | null>(null);
    const [builtSentenceParts, setBuiltSentenceParts] = useState<{ part: string; id: string }[]>([]);
    const [error, setError] = useState<string | null>(null);
    
    const fetchNextTask = useCallback(() => {
        if (!userData || !gemini) return;
        setIsLoading(true); setFeedback(null); setAnswer(''); setBuiltSentenceParts([]); setError(null);
        gemini.generateLearningTask(userData)
            .then(nextTask => {
                 if (!nextTask || !nextTask.type) throw new Error("Received an invalid task from the API.");
                if (nextTask.type === 'BuildSentence' && nextTask.parts) {
                    nextTask.augmentedParts = nextTask.parts.map((part, index) => ({ part, id: `${part}-${index}` }));
                }
                setTask(nextTask);
            }).catch(err => {
                console.error("Failed to generate task:", err);
                setError("Could not generate a new task. Please try refreshing.");
            }).finally(() => setIsLoading(false));
    }, [gemini, userData]);

    useEffect(() => { fetchNextTask(); }, [fetchNextTask]);

    const handleCheckAnswer = () => {
        if (!task) return;
        let isCorrect: boolean;
        let userAnswer = answer.trim();
        if (task.type === 'BuildSentence') userAnswer = builtSentenceParts.map(p => p.part).join(' ');
        const normalize = (str: string) => str.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g,"").replace(/\s+/g, ' ').trim();
        isCorrect = normalize(userAnswer) === normalize(task.correctAnswer);
        
        const feedbackExplanation = task.explanation;
        const feedbackCorrectAnswer = isCorrect ? null : task.correctSentence || task.correctAnswer;
        setFeedback({ isCorrect, explanation: feedbackExplanation, correctAnswer: feedbackCorrectAnswer });
    };

    const handleNext = async () => {
        if (!task || feedback === null) return;
        const newUserData: UserData = JSON.parse(JSON.stringify(userData));
        
        // Update core stats
        newUserData.tasksCompleted = (newUserData.tasksCompleted || 0) + 1;
        newUserData.taskHistory = [...(newUserData.taskHistory || []), task.type].slice(-LONG_TERM_TASK_HISTORY_LENGTH);

        // Update performance tracker
        const newPerformance = [...(newUserData.recentPerformance || []), feedback.isCorrect].slice(-PERFORMANCE_TRACKING_WINDOW);
        newUserData.recentPerformance = newPerformance;
        const correctCount = newPerformance.filter(p => p).length;
        
        // Update preparation mode
        newUserData.isPreparingForLevelUp = correctCount >= PREPARATION_MODE_THRESHOLD;

        // Update vocabulary
        const { wordToLearn } = task;
        if (wordToLearn) {
            let vocabulary: VocabularyWord[] = newUserData.vocabulary || [];
            const wordIndex = vocabulary.findIndex((v) => v.word.toLowerCase() === wordToLearn.toLowerCase());
            if (wordIndex !== -1) { 
                if (feedback.isCorrect) vocabulary[wordIndex].mastery += 1;
                else vocabulary[wordIndex].mastery = Math.max(0, vocabulary[wordIndex].mastery - 5);
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

        // Check for level up after saving
        if (newUserData.recentPerformance.length >= PERFORMANCE_TRACKING_WINDOW && correctCount >= LEVEL_UP_THRESHOLD) {
            triggerLevelUp();
        } else {
            fetchNextTask();
        }
    };
    
    const renderTaskInput = () => {
        if (!task) return null;
        switch (task.type) {
            case 'Listen': case 'Translate': case 'CorrectTheMistake': case 'FillInTheBlank':
                return (<input type="text" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer..." className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"/>);
            case 'MultipleChoice': case 'SynonymsAndAntonyms': case 'MatchDefinition': case 'OddOneOut': case 'Categorization': {
                if (!task.options || !Array.isArray(task.options)) return <p className="text-red-400">Error: Task data is corrupted (missing options).</p>;
                return (<div className="grid grid-cols-1 md:grid-cols-2 gap-4">{task.options.map(opt => (
                    <div key={opt} onClick={() => setAnswer(opt)} className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors cursor-pointer ${answer === opt ? 'bg-indigo-600 ring-2 ring-indigo-400' : 'bg-gray-800 hover:bg-gray-700'}`}>
                        <span className="text-left flex-grow mr-2">{opt}</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); TextToSpeechService.speak(opt); }} className="text-gray-400 hover:text-white flex-shrink-0 p-1 rounded-full hover:bg-gray-700" aria-label={`Listen to option`}>
                            <SpeakerWaveIcon className="w-5 h-5" />
                        </button>
                    </div>
                ))}</div>);
            }
            case 'BuildSentence': {
                if (!task.augmentedParts || !Array.isArray(task.augmentedParts)) return <p className="text-red-400">Error: Task data is corrupted (missing parts).</p>;
                const builtPartIds = new Set(builtSentenceParts.map(p => p.id));
                const remainingParts = task.augmentedParts.filter(p => !builtPartIds.has(p.id));
                return (
                    <div>
                        <div className="bg-gray-800 p-3 rounded-lg min-h-[50px] mb-4 border border-gray-700 flex flex-wrap gap-2 items-center">
                            {builtSentenceParts.length === 0 && <span className="text-gray-500">Click words below to build the sentence</span>}
                            {builtSentenceParts.map((p) => (<button type="button" key={p.id} className="bg-indigo-500 px-3 py-1 rounded-md" onClick={() => setBuiltSentenceParts(current => current.filter(item => item.id !== p.id))}>{p.part}</button>))}
                        </div>
                        <div className="flex flex-wrap gap-2">{remainingParts.map((p) => (<button type="button" key={p.id} className="bg-gray-700 px-3 py-1 rounded-md hover:bg-gray-600" onClick={() => setBuiltSentenceParts(current => [...current, p])}>{p.part}</button>))}</div>
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
    if (!task) return (<Card className="text-center"><h2 className="text-xl font-semibold">All done for now!</h2><p className="text-gray-400">Could not load a task. Please try refreshing.</p></Card>);
    
    if (feedback) {
        return <TaskFeedback isCorrect={feedback.isCorrect} explanation={feedback.explanation} correctAnswer={feedback.correctAnswer} onNext={handleNext} />;
    }

    const isAnswerProvided = task.type === 'BuildSentence' 
        ? builtSentenceParts.length > 0 
        : (['MultipleChoice', 'SynonymsAndAntonyms', 'MatchDefinition', 'OddOneOut', 'Categorization'].includes(task.type) ? answer !== '' : answer.trim() !== '');

    return (
        <div className="w-full max-w-2xl">
            <Card className="fade-in">
                <p className="text-sm font-medium text-indigo-400 mb-2">{task.type.replace(/([A-Z])/g, ' $1').trim()}</p>
                <h2 className="text-2xl font-semibold mb-4 flex items-center justify-between">
                    <span className="flex-grow pr-4">{task.question}</span>
                    <button type="button" onClick={() => TextToSpeechService.speak(task.audioPrompt || task.question)} className="text-gray-400 hover:text-white flex-shrink-0" aria-label="Listen to prompt"><SpeakerWaveIcon /></button>
                </h2>
                <div className="space-y-4">
                    {renderTaskInput()}
                     {task.type === 'WordDefinition' ? (
                         <Button onClick={() => setFeedback({isCorrect: true, explanation: task.explanation, correctAnswer: null})} className="w-full">Got it!</Button>
                     ) : (
                        <Button onClick={handleCheckAnswer} disabled={!isAnswerProvided} className="w-full">Check Answer</Button>
                     )}
                </div>
            </Card>
            <ProgressTracker performance={userData.recentPerformance || []} />
        </div>
    );
};

interface LevelUpPromptScreenProps { onAccept: () => void; onDecline: () => void; }
const LevelUpPromptScreen: React.FC<LevelUpPromptScreenProps> = ({ onAccept, onDecline }) => (
    <Card className="text-center fade-in">
        <h1 className="text-3xl font-bold text-amber-400 mb-4">Level Up Challenge!</h1>
        <p className="text-gray-300 mb-6">You're doing fantastic! You've demonstrated great skill. Are you ready to take a test for the next level?</p>
        <div className="flex justify-center gap-4">
            <Button onClick={onAccept} variant="primary">Let's do it!</Button>
            <Button onClick={onDecline} variant="secondary">Not yet</Button>
        </div>
    </Card>
);

interface LevelUpResultsScreenProps { isSuccess: boolean; nextLevel: CEFRLevel | null; onContinue: () => void; }
const LevelUpResultsScreen: React.FC<LevelUpResultsScreenProps> = ({ isSuccess, nextLevel, onContinue }) => (
    <Card className="text-center fade-in">
        {isSuccess ? <CheckCircleIcon /> : <XCircleIcon />}
        <h1 className={`text-3xl font-bold mt-4 mb-2 ${isSuccess ? 'text-green-400' : 'text-red-400'}`}>{isSuccess ? "Congratulations!" : "Almost There!"}</h1>
        {isSuccess && nextLevel ? (
            <p className="text-gray-300 mb-6">You passed! Welcome to level <span className="font-bold text-indigo-400">{nextLevel}</span>. Your learning path has been updated.</p>
        ) : (
             <p className="text-gray-300 mb-6">You did great, but didn't quite pass this time. Keep practicing, and you'll get it on the next try! Your progress has been reset.</p>
        )}
        <Button onClick={onContinue}>Continue Learning</Button>
    </Card>
);

interface VocabularyModalProps {
    isVisible: boolean;
    onClose: () => void;
    vocabulary: VocabularyWord[];
}
const VocabularyModal: React.FC<VocabularyModalProps> = ({ isVisible, onClose, vocabulary }) => {
    if (!isVisible) return null;

    const handleSpeak = (text: string, e: React.MouseEvent) => {
        e.stopPropagation();
        TextToSpeechService.speak(text);
    };

    return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center fade-in" onClick={onClose}>
            <Card className="w-full max-w-md m-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Your Vocabulary</h2>
                    <Button onClick={onClose} variant="secondary" className="!p-2 !h-10 !w-10 flex items-center justify-center text-lg">&times;</Button>
                </div>
                {vocabulary.length === 0 ? (
                    <p className="text-gray-400">Your vocabulary list is empty. Start learning to add words!</p>
                ) : (
                    <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                        {vocabulary.sort((a,b) => a.word.localeCompare(b.word)).map(({ word, mastery }) => (
                            <li key={word} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                                <span className="font-semibold">{word}</span>
                                <div className="flex items-center gap-4">
                                     <div className="flex items-center" title={`Mastery Level: ${mastery}/${VOCABULARY_MASTERY_THRESHOLD}`}>
                                        <span className="text-sm text-gray-400 mr-2">{mastery}</span>
                                        <StarIcon className="w-5 h-5 text-amber-400" />
                                    </div>
                                    <button type="button" onClick={(e) => handleSpeak(word, e)} className="text-gray-400 hover:text-white" aria-label={`Listen to ${word}`}>
                                        <SpeakerWaveIcon />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
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
    const [levelUpResults, setLevelUpResults] = useState<{isSuccess: boolean; nextLevel: CEFRLevel | null} | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isVocabularyVisible, setIsVocabularyVisible] = useState(false);
    
    // Auth and Data Loading Flow
    const handleAuthCallback = useCallback(async (tokenResponse: any) => {
        setAppState(AppState.DRIVE_LOADING);
        const token = tokenResponse.access_token;
        setAccessToken(token);
        try {
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!userInfoRes.ok) throw new Error('Failed to fetch user info.');
            const userInfo = await userInfoRes.json();
            setUser({ name: userInfo.name, email: userInfo.email, picture: userInfo.picture });

            const driveService = new GoogleDriveService(token);
            const fileId = await driveService.findOrCreateFile();
            setDriveFileId(fileId);

            let data = await driveService.getFileContent(fileId);
            
            // Check daily counter
            if (data.userData) {
                const today = getTodayDateString();
                if (data.userData.lastSessionDate !== today) {
                    data.userData.tasksToday = 0;
                    data.userData.lastSessionDate = today;
                }
            }
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
                setTimeout(initializeGsi, 100);
            }
        };
        initializeGsi();
    }, [handleAuthCallback]);

    useEffect(() => {
        if (!driveData) return;
        if (driveData.apiKey) {
            try {
                setGemini(new GeminiService(driveData.apiKey));
                if (driveData.userData) setAppState(AppState.LEARNING);
                else setAppState(AppState.WELCOME);
            } catch (e: any) {
                setError(`Failed to initialize with stored API Key. It might be invalid.`);
                setAppState(AppState.API_KEY_SETUP);
            }
        } else {
            setAppState(AppState.API_KEY_SETUP);
        }
    }, [driveData]);
    
    const saveDriveData = useCallback(async (newData: DriveData) => {
        if (!driveFileId || !accessToken) return;
        const driveService = new GoogleDriveService(accessToken);
        await driveService.saveFileContent(driveFileId, newData);
        setDriveData(newData);
    }, [accessToken, driveFileId]);

    const handleSaveUserData = async (newUserData: UserData) => {
        const today = getTodayDateString();
        if (newUserData.lastSessionDate !== today) {
            newUserData.tasksToday = 1;
            newUserData.lastSessionDate = today;
        } else {
            newUserData.tasksToday = (newUserData.tasksToday || 0) + 1;
        }
        await saveDriveData({ ...driveData!, userData: newUserData });
    };

    // Initial Assessment Flow
    useEffect(() => {
        if (appState === AppState.ASSESSMENT_LOADING && assessmentAnswers && gemini) {
            const evaluate = async () => {
                try {
                    const resultLevel = await gemini.evaluateInitialAssessment(assessmentAnswers);
                    const initialUserData: UserData = {
                        level: resultLevel, vocabulary: [], taskHistory: [], tasksCompleted: 0,
                        recentNewWords: [], tasksToday: 0, lastSessionDate: getTodayDateString(),
                        recentPerformance: [], isPreparingForLevelUp: false,
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
    }, [appState, assessmentAnswers, gemini, driveData, saveDriveData]);
    
    // Level Up Flow
    useEffect(() => {
        if (appState === AppState.LEVEL_UP_ASSESSMENT_LOADING && assessmentAnswers && driveData?.userData) {
            const evaluateLevelUp = async () => {
                const correctAnswers = assessmentAnswers.filter(a => a.answer === a.correctAnswer).length;
                const pass = correctAnswers / assessmentAnswers.length >= LEVEL_UP_PASS_PERCENTAGE;
                const currentUserData = driveData.userData!;
                let nextLevel: CEFRLevel | null = null;
                
                const newUserData = {...currentUserData};
                newUserData.recentPerformance = [];
                newUserData.isPreparingForLevelUp = false;

                if (pass) {
                    nextLevel = getNextLevel(currentUserData.level);
                    if (nextLevel) {
                        newUserData.level = nextLevel;
                    }
                }
                setLevelUpResults({ isSuccess: pass, nextLevel });
                await saveDriveData({ ...driveData!, userData: newUserData });
                setAppState(AppState.LEVEL_UP_RESULTS);
            };
            evaluateLevelUp();
        }
    }, [appState, assessmentAnswers, driveData, saveDriveData]);


    const handleSignIn = () => {
        if (window.tokenClient) window.tokenClient.requestAccessToken();
        else { setError("Google Auth is not ready. Please refresh the page."); setAppState(AppState.ERROR); }
    };
    
    const handleKeySaved = async (key: string) => await saveDriveData({ ...driveData!, apiKey: key });
    const handleStartAssessment = () => setAppState(AppState.ASSESSING);
    const handleCompleteAssessment = (answers: AssessmentAnswer[]) => { setAssessmentAnswers(answers); setAppState(AppState.ASSESSMENT_LOADING); };
    const handleStartLearning = () => {
        if (driveData?.userData) setAppState(AppState.LEARNING);
        else { setError("Could not start learning session. User data not found."); setAppState(AppState.ERROR); }
    };
    const handleSignOut = () => {
        if (accessToken) window.google.accounts.oauth2.revoke(accessToken, () => {});
        setUser(null); setAccessToken(null); setDriveData(null); setDriveFileId(null); setGemini(null); setAppState(AppState.AUTH);
    };

    // Level up handlers
    const handleTriggerLevelUp = () => setAppState(AppState.LEVEL_UP_PROMPT);
    const handleAcceptLevelUp = () => setAppState(AppState.LEVEL_UP_ASSESSMENT);
    const handleDeclineLevelUp = () => setAppState(AppState.LEARNING);
    const handleCompleteLevelUpAssessment = (answers: AssessmentAnswer[]) => { setAssessmentAnswers(answers); setAppState(AppState.LEVEL_UP_ASSESSMENT_LOADING); };
    const handleContinueFromLevelUp = () => { setLevelUpResults(null); setAssessmentAnswers(null); setAppState(AppState.LEARNING); };


    const renderContent = () => {
        switch (appState) {
            case AppState.AUTH: return <AuthScreen onSignIn={handleSignIn} />;
            case AppState.DRIVE_LOADING: return <Loader text="Connecting to Google Drive..." />;
            case AppState.API_KEY_SETUP: return <ApiKeySetupScreen onKeySaved={handleKeySaved} />;
            case AppState.WELCOME:
                if (!user) return <Loader text="Loading..." />;
                return <WelcomeScreen userName={user.name} onStartAssessment={handleStartAssessment} />;
            case AppState.ASSESSING:
                if (!gemini) return <Loader text="Initializing..." />;
                return <AssessmentScreen gemini={gemini} onComplete={handleCompleteAssessment} questionCount={INITIAL_ASSESSMENT_QUESTIONS} assessmentType="initial"/>;
            case AppState.ASSESSMENT_LOADING: return <Loader text="Evaluating your answers..." />;
            case AppState.RESULTS:
                if (!driveData?.userData?.level) return <Loader text="Loading results..." />;
                return <ResultsScreen level={driveData.userData.level} onStartLearning={handleStartLearning} />;
            case AppState.LEARNING:
                if (!gemini || !driveData?.userData) return <Loader text="Loading your learning path..." />;
                return <LearningDashboard gemini={gemini} userData={driveData.userData} saveUserData={handleSaveUserData} triggerLevelUp={handleTriggerLevelUp} />;
            case AppState.LEVEL_UP_PROMPT: return <LevelUpPromptScreen onAccept={handleAcceptLevelUp} onDecline={handleDeclineLevelUp} />;
            case AppState.LEVEL_UP_ASSESSMENT:
                if (!gemini || !driveData?.userData) return <Loader text="Initializing..." />;
                return <AssessmentScreen gemini={gemini} onComplete={handleCompleteLevelUpAssessment} questionCount={LEVEL_UP_ASSESSMENT_QUESTIONS} assessmentType="levelup" levelToTest={driveData.userData.level} />;
            case AppState.LEVEL_UP_ASSESSMENT_LOADING: return <Loader text="Evaluating your level up test..."/>;
            case AppState.LEVEL_UP_RESULTS:
                 if (!levelUpResults) return <Loader text="Finalizing results..."/>
                 return <LevelUpResultsScreen isSuccess={levelUpResults.isSuccess} nextLevel={levelUpResults.nextLevel} onContinue={handleContinueFromLevelUp} />;
            case AppState.ERROR: return (<Card className="text-center"><h1 className="text-2xl font-bold text-red-400">Application Error</h1><p className="text-gray-300 mt-2">{error || "An unknown error occurred."}</p><Button onClick={() => window.location.reload()} className="mt-4">Refresh Page</Button></Card>);
            default: return <Loader text="Initializing..." />;
        }
    };
    
    return (
        <main className="relative min-h-screen flex flex-col items-center justify-center p-4 pt-24 md:pt-4 bg-gray-950 text-gray-100">
            <Header user={user} onSignOut={handleSignOut} tasksToday={driveData?.userData?.tasksToday || 0} onToggleVocabulary={() => setIsVocabularyVisible(v => !v)} />
             {driveData?.userData && <VocabularyModal isVisible={isVocabularyVisible} onClose={() => setIsVocabularyVisible(false)} vocabulary={driveData.userData.vocabulary || []} />}
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
    root.render(<React.StrictMode><App /></React.StrictMode>);
} else {
    console.error("Fatal Error: Root element not found.");
}
