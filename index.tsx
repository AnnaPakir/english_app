import React, { useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// ==========================================================================================
// Bсе типы, константы, компоненты и сервисы объединены в этом файле,
// чтобы Babel мог обработать все приложение целиком. Локальные импорты и экспорты удалены.
// ==========================================================================================


// --- From types.ts ---
enum CEFRLevel {
    A1 = "A1 (Beginner)",
    A2 = "A2 (Elementary)",
    B1 = "B1 (Intermediate)",
    B2 = "B2 (Upper-Intermediate)",
    C1 = "C1 (Advanced)",
}

enum AppState {
    AUTH,
    WELCOME,
    ASSESSING,
    ASSESSMENT_LOADING,
    RESULTS,
    LEARNING,
    LEVEL_UP_ASSESSMENT_LOADING,
    LEVEL_UP_ASSESSING,
    LEVEL_UP_RESULTS,
}

interface AssessmentQuestion {
    question: string;
    options: string[];
    correctAnswer: string;
    level: CEFRLevel;
}

type TaskType = 'reading' | 'vocabulary' | 'grammar' | 'image' | 'dialogue' | 'story' | 'editing';

interface LearningTask {
    type: TaskType;
    title: string;
    level: CEFRLevel;
    content: string;
    questions?: {
        question: string;
        options: string[];
        correctAnswer: string;
    }[];
    context?: string;
    constraints?: string;
    words?: string[];
    grammarConstraint?: string;
    originalText?: string;
}

interface TaskEvaluation {
    isCorrect: boolean;
    feedback: string;
}

interface User {
    name: string;
    imageUrl: string;
}

interface UserData {
    user: User;
    apiKey: string;
    level: CEFRLevel | null;
    imageGeneration: {
        count: number;
        date: string; // YYYY-MM-DD
    };
    taskHistory: boolean[]; // true for correct, false for incorrect
    dailyStats: {
        date: string; // YYYY-MM-DD
        completed: number;
        correct: number;
    };
    feedbackHistory: string[];
}

// --- From constants.ts ---
const CEFR_LEVELS_ORDER: CEFRLevel[] = [
    CEFRLevel.A1,
    CEFRLevel.A2,
    CEFRLevel.B1,
    CEFRLevel.B2,
    CEFRLevel.C1,
];
const PROGRESS_HISTORY_LENGTH = 100;
const PROGRESS_UNLOCK_THRESHOLD = 80;
const LEVEL_UP_TEST_QUESTIONS = 50;
const LEVEL_UP_PASS_PERCENTAGE = 0.8;

// --- From components/common/Card.tsx ---
interface CardProps {
    children: React.ReactNode;
    className?: string;
}
const Card: React.FC<CardProps> = ({ children, className = '' }) => {
    return (
        <div className={`bg-slate-800 border border-slate-700 rounded-xl shadow-lg p-6 sm:p-8 ${className}`}>
            {children}
        </div>
    );
};

// --- From components/common/Button.tsx ---
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary' | 'ghost' | 'google';
    isLoading?: boolean;
    icon?: React.ReactNode;
}
const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', isLoading = false, className = '', icon, ...props }) => {
    const baseClasses = "font-bold py-2 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 ease-in-out inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed text-base";
    const variantClasses = {
        primary: "bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500 text-white",
        secondary: "bg-slate-600 hover:bg-slate-700 focus:ring-slate-500 text-white",
        ghost: "bg-transparent hover:bg-slate-700 focus:ring-slate-500 text-slate-300",
        google: "bg-white hover:bg-gray-200 focus:ring-blue-500 text-gray-800 border border-gray-300",
    };
    return (
        <button className={`${baseClasses} ${variantClasses[variant]} ${className}`} disabled={isLoading || props.disabled} {...props}>
            {isLoading ? (
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            ) : (
                <>{icon && <span className="mr-2">{icon}</span>}{children}</>
            )}
        </button>
    );
};

// --- From components/common/Loader.tsx ---
interface LoaderProps {
    text: string;
}
const Loader: React.FC<LoaderProps> = ({ text }) => {
    return (
        <div className="flex flex-col items-center justify-center text-center p-8">
            <svg className="animate-spin h-12 w-12 text-indigo-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-xl font-semibold text-slate-300">{text}</p>
        </div>
    );
};

// --- From services/geminiService.ts ---
class GeminiService {
    private ai: GoogleGenAI;

    constructor(apiKey: string) {
        if (!apiKey) throw new Error("API key is required to initialize GeminiService.");
        this.ai = new GoogleGenAI({ apiKey: apiKey });
    }

    private parseJsonResponse = <T,>(text: string): T | null => {
        let jsonStr = text.trim();
        const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
        const match = jsonStr.match(fenceRegex);
        if (match && match[2]) jsonStr = match[2].trim();
        try {
            return JSON.parse(jsonStr) as T;
        } catch (e) {
            console.error("Failed to parse JSON response:", e, "Raw text:", text);
            return null;
        }
    };

    async generateAssessmentTest(): Promise<AssessmentQuestion[]> {
        const prompt = `
        Create a 30-question English proficiency test to accurately determine a user's CEFR level.
        The test must be comprehensive and include a balanced distribution of questions across levels A1 to B2.
        - 6 questions for A1 level
        - 7 questions for A2 level
        - 9 questions for B1 level
        - 8 questions for B2 level

        For each question, provide a clear question, 4 multiple-choice options, and the correct answer.
        The 'level' field must be one of: "A1 (Beginner)", "A2 (Elementary)", "B1 (Intermediate)", "B2 (Upper-Intermediate)".

        Return the result as a JSON array of objects. Each object must have this exact structure:
        { "question": "string", "options": ["string", "string", "string", "string"], "correctAnswer": "string", "level": "CEFRLevel" }
        
        Do not include C1 or C2 questions. The response must be only the JSON array.
        `;
        try {
            const response: GenerateContentResponse = await this.ai.models.generateContent({ model: "gemini-2.5-flash-preview-04-17", contents: prompt, config: { responseMimeType: "application/json", temperature: 0.7 } });
            const questions = this.parseJsonResponse<AssessmentQuestion[]>(response.text);
            if (!questions || !Array.isArray(questions) || questions.length < 30) throw new Error("Could not generate a valid assessment test.");
            return questions;
        } catch (error) {
            console.error("Error generating assessment test:", error);
            throw new Error("Failed to communicate with the AI. Please check your connection and API key.");
        }
    }

    async generateLevelUpTest(level: CEFRLevel): Promise<AssessmentQuestion[]> {
        const prompt = `
        Create a challenging ${LEVEL_UP_TEST_QUESTIONS}-question English proficiency test to confirm a user's mastery of the ${level} CEFR level.
        This test is for a user who is currently at the ${level} level and wants to prove they have mastered it before advancing.
        The questions should be difficult and cover a wide range of grammar, vocabulary, and reading comprehension topics appropriate for the ${level} level.
        For each question, provide a clear question, 4 multiple-choice options, and the correct answer.
        The 'level' field for all questions must be "${level}".
        Return the result as a JSON array of objects. Each object must have this exact structure:
        { "question": "string", "options": ["string", "string", "string", "string"], "correctAnswer": "string", "level": "${level}" }
        The response must be only the JSON array.`;
        try {
             const response: GenerateContentResponse = await this.ai.models.generateContent({ model: "gemini-2.5-flash-preview-04-17", contents: prompt, config: { responseMimeType: "application/json", temperature: 0.8 } });
            const questions = this.parseJsonResponse<AssessmentQuestion[]>(response.text);
            if (!questions || !Array.isArray(questions) || questions.length < LEVEL_UP_TEST_QUESTIONS) throw new Error("Could not generate a valid level-up test.");
            return questions.slice(0, LEVEL_UP_TEST_QUESTIONS);
        } catch (error) {
            console.error(`Error generating level-up test for ${level}:`, error);
            throw new Error("Failed to communicate with the AI for the level-up test.");
        }
    }

    async generateLearningTask(level: CEFRLevel, feedbackHistory: string[]): Promise<LearningTask | null> {
        const feedbackPrompt = feedbackHistory.length > 0 
            ? `CRITICAL: The user has provided the following feedback on previous tasks. You MUST take this into account to personalize the experience.
            - Avoid topics or tasks the user finds boring or unhelpful. - Prioritize topics or task types the user finds useful or interesting.
            - Here is the user's feedback history (most recent first):
            ${feedbackHistory.slice(-5).reverse().map(f => `- "${f}"`).join('\n')}` : '';
        const prompt = `
        Create a single English learning task for a user at the ${level} CEFR level. The difficulty, vocabulary, and grammar MUST be strictly appropriate for the ${level} level.
        ${feedbackPrompt}
        Randomly choose one of the following task types: 'reading', 'vocabulary', 'grammar', 'image', 'dialogue', 'story', 'editing'.
        Return the result as a single, well-formed JSON object. The response must be only the JSON object. The JSON object MUST include a "level": "${level}" field.
        Here are the structures for each type:
        1. For 'reading', 'vocabulary', 'grammar', 'image': { "type": "string", "title": "string", "level": "${level}", "content": "string", "questions": [{ "question": "string", "options": ["...", "...", "..."], "correctAnswer": "string" }] }
        2. For 'dialogue': { "type": "dialogue", "title": "Dialogue Completion", "level": "${level}", "context": "string", "content": "string", "constraints": "string" }
        3. For 'story': { "type": "story", "title": "Creative Story Writing", "level": "${level}", "content": "string", "words": ["word1", "word2", "word3"], "grammarConstraint": "string" }
        4. For 'editing': { "type": "editing", "title": "Translation Editing", "level": "${level}", "originalText": "string", "content": "string", "constraints": "string" }`;
        try {
            const response: GenerateContentResponse = await this.ai.models.generateContent({ model: "gemini-2.5-flash-preview-04-17", contents: prompt, config: { responseMimeType: "application/json", temperature: 1.0 } });
            const task = this.parseJsonResponse<LearningTask>(response.text);
            if (!task || !task.type || !task.title || !task.content) throw new Error("Generated task is missing required fields.");
            return task;
        } catch (error) {
            console.error("Error generating learning task:", error);
            throw new Error("Failed to generate a new learning task.");
        }
    }
    
    async evaluateTextTask(task: LearningTask, userInput: string): Promise<TaskEvaluation> {
        let prompt = `An English learner at the ${task.level} level was given a task. Evaluate their response as a JSON object: { "isCorrect": boolean, "feedback": "string" }. The feedback MUST be in simple Russian, encouraging, and clear.
        Task Type: ${task.type}; User's Response: "${userInput}"`;
        switch (task.type) {
            case 'dialogue': prompt += `Context: "${task.context}"; Initial Line: "${task.content}"; Constraints: "${task.constraints}"`; break;
            case 'story': prompt += `Words: ${task.words?.join(', ')}; Grammar: "${task.grammarConstraint}"`; break;
            case 'editing': prompt += `Original: "${task.originalText}"; Imperfect: "${task.content}"`; break;
            default: return { isCorrect: false, feedback: "Неверный тип задания для оценки." };
        }
        try {
            const response = await this.ai.models.generateContent({ model: "gemini-2.5-flash-preview-04-17", contents: prompt, config: { responseMimeType: "application/json" } });
            const evaluation = this.parseJsonResponse<TaskEvaluation>(response.text);
            if (!evaluation || typeof evaluation.isCorrect !== 'boolean' || !evaluation.feedback) throw new Error("Invalid evaluation format from AI.");
            return evaluation;
        } catch (error) {
            console.error("Error evaluating text task:", error);
            return { isCorrect: false, feedback: "Не удалось оценить ваш ответ. Пожалуйста, попробуйте еще раз." };
        }
    }

    async getExplanation(question: string, correctAnswer: string, userAnswer: string): Promise<string> {
        const prompt = `An English learner was asked: "${question}". Correct answer: "${correctAnswer}". They answered: "${userAnswer}". Provide a 1-2 sentence explanation in simple Russian why their answer is wrong.`;
        try {
            const response = await this.ai.models.generateContent({ model: "gemini-2.5-flash-preview-04-17", contents: prompt });
            return response.text;
        } catch (error) {
            console.error("Error getting explanation:", error);
            return "Не удалось получить объяснение.";
        }
    }

    async generateImage(prompt: string): Promise<string> {
        try {
            const response = await this.ai.models.generateImages({ model: 'imagen-3.0-generate-002', prompt, config: {numberOfImages: 1, outputMimeType: 'image/jpeg'} });
            if (!response.generatedImages || response.generatedImages.length === 0) throw new Error("API did not return any images.");
            return `data:image/jpeg;base64,${response.generatedImages[0].image.imageBytes}`;
        } catch (error) {
            console.error("Error generating image:", error);
            throw new Error("Failed to generate image. The model may have refused the prompt.");
        }
    }
}

// --- From components/AuthScreen.tsx ---
interface AuthScreenProps { onAuth: (name: string, apiKey: string) => void; error: string | null; }
const AuthScreen: React.FC<AuthScreenProps> = ({ onAuth, error }) => {
    const [name, setName] = useState('');
    const [apiKey, setApiKey] = useState('');
    const handleAuthClick = () => { if(name.trim() && apiKey.trim()) onAuth(name.trim(), apiKey.trim()); };
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
            <Card className="max-w-md w-full text-center animate-fade-in-up">
                <h1 className="text-3xl font-bold text-slate-100 mb-2">Gemini English Tutor</h1>
                <p className="text-slate-400 mb-8">Введите ваше имя и API ключ для начала.</p>
                <form onSubmit={(e) => { e.preventDefault(); handleAuthClick(); }} className='space-y-4'>
                    <input id="name-input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Введите ваше имя" required className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                    <input id="api-key-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Введите ваш Google AI API ключ" required className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                    {error && <p className="text-red-400 text-sm">{error}</p>}
                    <Button type="submit" variant="primary" className="w-full text-lg py-3" disabled={!name.trim() || !apiKey.trim()}>Войти</Button>
                </form>
            </Card>
        </div>
    );
};

// --- From components/Header.tsx ---
interface HeaderProps { user: User; onReset: () => void; level: CEFRLevel | null; dailyStats: UserData['dailyStats']; }
const Header: React.FC<HeaderProps> = ({ user, onReset, level, dailyStats }) => (
    <header className="py-4 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto flex justify-between items-center border-b border-slate-700 pb-4">
            <div className="flex items-center gap-3">
                <img src={user.imageUrl} alt={user.name} className="w-10 h-10 rounded-full border-2 border-slate-600" />
                <div className="flex items-center gap-x-3 flex-wrap">
                    <h1 className="font-bold text-slate-100">{user.name}</h1>
                    {level && <span className="bg-indigo-600/50 text-indigo-300 text-xs font-medium px-2.5 py-0.5 rounded-full border border-indigo-500">{level}</span>}
                    <div className="text-sm text-slate-400">
                        <span>Задания сегодня: </span>
                        <span className="font-bold text-green-400">{dailyStats.correct}</span>
                        <span> / </span>
                        <span className="font-bold text-slate-300">{dailyStats.completed}</span>
                    </div>
                </div>
            </div>
            <Button onClick={onReset} variant="secondary">Выйти</Button>
        </div>
    </header>
);

// --- From components/WelcomeScreen.tsx ---
interface WelcomeScreenProps { user: User; onStart: () => void; }
const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ user, onStart }) => (
    <div className="flex flex-col items-center justify-center py-12">
        <Card className="max-w-2xl text-center animate-fade-in-up">
            <img src={user.imageUrl} alt={user.name} className="w-24 h-24 rounded-full mx-auto mb-4 border-4 border-slate-700" />
            <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500 mb-4">Добро пожаловать, {user.name}!</h1>
            <p className="text-slate-300 text-lg mb-8">Пройдите быстрый тест, чтобы определить свой уровень, и получите персонализированные задания для изучения английского языка.</p>
            <Button onClick={onStart} className="px-8 py-3 text-lg">Начать тест</Button>
        </Card>
    </div>
);

// --- From components/Assessment.tsx ---
interface AssessmentProps { questions: AssessmentQuestion[]; onComplete: (level: CEFRLevel) => void; }
const Assessment: React.FC<AssessmentProps> = ({ questions, onComplete }) => {
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [isAnswered, setIsAnswered] = useState(false);
    const [scores, setScores] = useState<Record<string, number>>({ [CEFRLevel.A1]: 0, [CEFRLevel.A2]: 0, [CEFRLevel.B1]: 0, [CEFRLevel.B2]: 0, [CEFRLevel.C1]: 0 });
    const currentQuestion = questions[currentQuestionIndex];
    const handleAnswerSelect = (option: string) => {
        if (isAnswered) return;
        setSelectedAnswer(option);
        setIsAnswered(true);
        if (option === currentQuestion.correctAnswer) setScores(prev => ({ ...prev, [currentQuestion.level]: (prev[currentQuestion.level] || 0) + 1 }));
    };
    const handleNext = () => {
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
            setSelectedAnswer(null);
            setIsAnswered(false);
        } else {
            const questionsPerLevel: Record<string, number> = {};
            questions.forEach(q => { questionsPerLevel[q.level] = (questionsPerLevel[q.level] || 0) + 1; });
            let determinedLevel = CEFRLevel.A1;
            for (const level of CEFR_LEVELS_ORDER) {
                if ((questionsPerLevel[level] || 0) > 0 && (scores[level] || 0) / questionsPerLevel[level] >= 0.5) determinedLevel = level;
                else if ((questionsPerLevel[level] || 0) > 0) break;
            }
            onComplete(determinedLevel);
        }
    };
    const getButtonClass = (option: string) => {
        if (!isAnswered) return 'bg-slate-700 hover:bg-slate-600';
        if (option === currentQuestion.correctAnswer) return 'bg-green-600';
        if (option === selectedAnswer) return 'bg-red-600';
        return 'bg-slate-700 opacity-60';
    };
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <Card className="w-full max-w-2xl">
                <div className="mb-4">
                    <div className="flex justify-between mb-1"><span className="text-base font-medium text-indigo-400">Прогресс</span><span className="text-sm font-medium text-indigo-400">{currentQuestionIndex + 1} / {questions.length}</span></div>
                    <div className="w-full bg-slate-700 rounded-full h-2.5"><div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}></div></div>
                </div>
                <h2 className="text-2xl font-bold text-slate-100 mb-2">{`Вопрос ${currentQuestionIndex + 1}`}</h2>
                <p className="text-slate-300 text-lg mb-6">{currentQuestion.question}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">{currentQuestion.options.map((option, index) => <button key={index} onClick={() => handleAnswerSelect(option)} disabled={isAnswered} className={`w-full p-4 rounded-lg text-left transition-colors duration-300 ${getButtonClass(option)}`}>{option}</button>)}</div>
                {isAnswered && <div className="text-right"><Button onClick={handleNext}>{currentQuestionIndex < questions.length - 1 ? 'Следующий вопрос' : 'Завершить'}</Button></div>}
            </Card>
        </div>
    );
};

// --- From components/ResultsScreen.tsx ---
interface ResultsScreenProps { level: CEFRLevel; onStartLearning: () => void; }
const ResultsScreen: React.FC<ResultsScreenProps> = ({ level, onStartLearning }) => (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Card className="max-w-xl text-center animate-fade-in-up">
            <h2 className="text-3xl font-bold text-slate-100 mb-2">Тест завершен!</h2>
            <p className="text-slate-300 text-lg mb-4">Ваш предполагаемый уровень владения английским:</p>
            <div className="bg-indigo-600 text-white text-4xl font-bold rounded-lg py-4 px-8 inline-block mb-8">{level}</div>
            <p className="text-slate-400 mb-8">Теперь вы готовы начать выполнять задания, соответствующие вашему уровню.</p>
            <Button onClick={onStartLearning} className="px-8 py-3 text-lg">Начать обучение</Button>
        </Card>
    </div>
);

// --- From components/ProgressTracker.tsx ---
interface ProgressTrackerProps { history: boolean[]; }
const ProgressTracker: React.FC<ProgressTrackerProps> = ({ history }) => {
    const correctCount = history.filter(h => h).length;
    const progressPercentage = Math.min((correctCount / PROGRESS_UNLOCK_THRESHOLD) * 100, 100);
    return (
        <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-lg p-4">
            <div className="flex justify-between items-center mb-2"><h3 className="font-bold text-slate-200">Прогресс к следующему уровню</h3><span className="text-lg font-mono font-bold text-indigo-300">{correctCount} / {PROGRESS_UNLOCK_THRESHOLD}</span></div>
            <p className="text-sm text-slate-400 mb-3">Правильно ответьте на {PROGRESS_UNLOCK_THRESHOLD} из последних {PROGRESS_HISTORY_LENGTH} заданий, чтобы разблокировать тест на повышение уровня.</p>
            <div className="w-full bg-slate-700 rounded-full h-4 relative overflow-hidden"><div className="bg-gradient-to-r from-teal-400 to-indigo-500 h-4 rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercentage}%` }}></div></div>
        </div>
    );
};

// --- From components/LevelUpAssessment.tsx ---
interface LevelUpAssessmentProps { questions: AssessmentQuestion[]; onComplete: (score: number) => void; }
const LevelUpAssessment: React.FC<LevelUpAssessmentProps> = ({ questions, onComplete }) => {
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [correctAnswersCount, setCorrectAnswersCount] = useState(0);
    const [isFinished, setIsFinished] = useState(false);
    useEffect(() => {
        if (questions.length > 0 && currentQuestionIndex >= questions.length && !isFinished) {
            setIsFinished(true);
            onComplete(correctAnswersCount / questions.length);
        }
    }, [currentQuestionIndex, correctAnswersCount, questions.length, onComplete, isFinished]);
    const handleAnswerSelect = (option: string) => {
        if (selectedAnswer) return;
        setSelectedAnswer(option);
        if (option === questions[currentQuestionIndex].correctAnswer) setCorrectAnswersCount(prev => prev + 1);
        setTimeout(() => {
            setCurrentQuestionIndex(prev => prev + 1);
            setSelectedAnswer(null);
        }, 500);
    };
    if (currentQuestionIndex >= questions.length) return <div className="flex flex-col items-center justify-center min-h-screen p-4"><Loader text="Подсчет результатов..." /></div>;
    const currentQuestion = questions[currentQuestionIndex];
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <Card className="w-full max-w-2xl">
                <div className="mb-6"><h2 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500 mb-2">Тест на повышение уровня</h2><p className="text-center text-slate-400">Для прохождения нужно ответить правильно на {LEVEL_UP_PASS_PERCENTAGE * 100}% вопросов.</p></div>
                <div className="mb-4">
                    <div className="flex justify-between mb-1"><span className="text-base font-medium text-indigo-400">Прогресс</span><span className="text-sm font-medium text-indigo-400">{currentQuestionIndex + 1} / {questions.length}</span></div>
                    <div className="w-full bg-slate-700 rounded-full h-2.5"><div className="bg-indigo-600 h-2.5 rounded-full transition-width duration-300" style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}></div></div>
                </div>
                <h3 className="text-2xl font-bold text-slate-100 mb-2">{`Вопрос ${currentQuestionIndex + 1}`}</h3><p className="text-slate-300 text-lg mb-6">{currentQuestion.question}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{currentQuestion.options.map((option, index) => <button key={index} onClick={() => handleAnswerSelect(option)} disabled={!!selectedAnswer} className={`w-full p-4 rounded-lg text-left transition-colors duration-300 ${selectedAnswer === null ? 'bg-slate-700 hover:bg-slate-600' : ''}${selectedAnswer === option && option === currentQuestion.correctAnswer ? 'bg-green-600' : ''}${selectedAnswer === option && option !== currentQuestion.correctAnswer ? 'bg-red-600' : ''}${selectedAnswer !== null && selectedAnswer !== option ? 'bg-slate-700 opacity-50' : ''}`}>{option}</button>))}</div>
            </Card>
        </div>
    );
};

// --- From components/LevelUpResultsScreen.tsx ---
interface LevelUpResultsScreenProps { isSuccess: boolean; newLevel: CEFRLevel | null; onContinue: () => void; }
const LevelUpResultsScreen: React.FC<LevelUpResultsScreenProps> = ({ isSuccess, newLevel, onContinue }) => (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Card className="max-w-xl text-center animate-fade-in-up">
            {isSuccess ? (
                <><h2 className="text-3xl font-bold text-green-400 mb-2">Поздравляем!</h2><p className="text-slate-300 text-lg mb-4">Вы успешно прошли тест и перешли на новый уровень:</p><div className="bg-green-600 text-white text-4xl font-bold rounded-lg py-4 px-8 inline-block mb-8">{newLevel}</div><p className="text-slate-400 mb-8">Ваш прогресс сброшен. Продолжайте в том же духе!</p></>
            ) : (
                <><h2 className="text-3xl font-bold text-yellow-400 mb-2">Почти получилось!</h2><p className="text-slate-300 text-lg mb-4">К сожалению, в этот раз не удалось пройти тест.</p><p className="text-slate-400 mb-8">Не волнуйтесь! Ваш прогресс сброшен, и вы можете продолжить практиковаться на своем текущем уровне, чтобы попробовать снова.</p></>
            )}
            <Button onClick={onContinue} className="px-8 py-3 text-lg">Продолжить обучение</Button>
        </Card>
    </div>
);

// --- From components/LearningDashboard.tsx ---
interface LearningDashboardProps { geminiService: GeminiService; userData: UserData; onUserDataChange: (newUserData: UserData) => void; onTaskComplete: (results: boolean[]) => void; onStartLevelUpTest: () => void; onFeedbackSubmit: (feedback: string) => void; }
const LearningDashboard: React.FC<LearningDashboardProps> = ({ geminiService, userData, onUserDataChange, onTaskComplete, onStartLevelUpTest, onFeedbackSubmit }) => {
    const [task, setTask] = useState<LearningTask | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
    const [taskResults, setTaskResults] = useState<boolean[]>([]);
    const [explanations, setExplanations] = useState<Record<number, string | null>>({});
    const [userInput, setUserInput] = useState("");
    const [evaluation, setEvaluation] = useState<TaskEvaluation | null>(null);
    const [showResults, setShowResults] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [showFeedbackForm, setShowFeedbackForm] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");
    const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

    const INTERACTIVE_TASK_TYPES: TaskType[] = ['dialogue', 'story', 'editing'];
    const fetchTask = useCallback(async (isRetry: boolean = false) => {
        if (!isRetry) {
            setTask(null); setSelectedAnswers({}); setShowResults(false); setTaskResults([]); setExplanations({}); setIsChecking(false); setGeneratedImage(null); setIsGeneratingImage(false); setUserInput(""); setEvaluation(null); setShowFeedbackForm(false); setFeedbackText(""); setFeedbackSubmitted(false);
            setIsLoading(true); setError(null);
        } else { setError(null); setIsLoading(true); }
        try {
            const newTask = await geminiService.generateLearningTask(userData.level!, userData.feedbackHistory);
            if (!newTask) throw new Error("Received empty task from API.");
            setTask(newTask);
        } catch (err: any) { setError(err.message || 'An unknown error occurred.'); } 
        finally { setIsLoading(false); }
    }, [userData.level, userData.feedbackHistory, geminiService]);
    useEffect(() => { fetchTask(); }, [fetchTask]);
    
    const handleCheckAnswers = async () => {
        if (!task) return;
        setIsChecking(true);
        if (task.type && INTERACTIVE_TASK_TYPES.includes(task.type)) {
            const result = await geminiService.evaluateTextTask(task, userInput);
            setEvaluation(result);
            onTaskComplete([result.isCorrect]);
        } else if (task.questions) {
            const newExplanations: Record<number, string> = {};
            const explanationPromises: Promise<void>[] = task.questions.map((q, index) => {
                const userAnswer = selectedAnswers[index];
                if (userAnswer && userAnswer !== q.correctAnswer) return geminiService.getExplanation(q.question, q.correctAnswer, userAnswer).then(exp => { newExplanations[index] = exp; });
                return Promise.resolve();
            });
            await Promise.all(explanationPromises);
            setExplanations(newExplanations);
            const results = task.questions.map((q, i) => selectedAnswers[i] === q.correctAnswer);
            setTaskResults(results);
            onTaskComplete(results);
            if (task.type === 'image' && results[0] === true) {
                if (userData.imageGeneration.count < 10) {
                     setIsGeneratingImage(true); setError(null);
                    try {
                        const imageUrl = await geminiService.generateImage(task.questions[0].correctAnswer);
                        setGeneratedImage(imageUrl);
                        onUserDataChange({ ...userData, imageGeneration: { ...userData.imageGeneration, count: userData.imageGeneration.count + 1 } });
                    } catch (err: any) { setError(err.message || "Failed to generate image."); } 
                    finally { setIsGeneratingImage(false); }
                }
            }
        }
        setShowResults(true); setIsChecking(false);
    };

    const handleFeedbackFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (feedbackText.trim()) {
            onFeedbackSubmit(feedbackText.trim());
            setFeedbackSubmitted(true);
            setShowFeedbackForm(false);
        }
    };

    const canAttemptLevelUp = (userData.taskHistory.filter(Boolean).length >= PROGRESS_UNLOCK_THRESHOLD);
    const isInteractiveTask = task?.type && INTERACTIVE_TASK_TYPES.includes(task.type);

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
                {task.type === 'image' && <p className="text-slate-500 text-sm mb-4 text-center">Использовано генераций сегодня: {userData.imageGeneration.count} / 10</p>}
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
                        {userData.imageGeneration.count >= 10 && !generatedImage && taskResults[0] && <p className="text-slate-500 text-sm mt-4">Вы ответили правильно, но, к сожалению, достигли дневного лимита генераций.</p>}
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
        if (feedbackSubmitted) return <div className="mt-4 text-center text-green-400 font-semibold">Спасибо за ваш отзыв!</div>
        if (showFeedbackForm) {
            return (
                <form onSubmit={handleFeedbackFormSubmit} className="mt-6 border-t border-slate-700 pt-6">
                    <label htmlFor="feedback-input" className="block text-sm font-medium text-slate-300 mb-2">Что вы думаете об этом задании? Ваш отзыв поможет сделать обучение лучше.</label>
                    <textarea id="feedback-input" value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} rows={3} className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none" placeholder="Например: 'Это было слишком легко' или 'Больше заданий на грамматику!'"/>
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
    };
    
    return (
        <div className="py-8">
            <header className="mb-8">
                <ProgressTracker history={userData.taskHistory} />
                {(canAttemptLevelUp) && (
                     <Card className="mt-4 text-center bg-indigo-900/50 border-indigo-700">
                        <h3 className="text-xl font-bold text-white">Поздравляем!</h3>
                        <p className="text-indigo-200 mt-2 mb-4">Вы готовы проверить свои знания и перейти на следующий уровень?</p>
                        <Button onClick={onStartLevelUpTest} variant="primary">Пройти тест на повышение</Button>
                     </Card>
                )}
            </header>
            <main>
                {isLoading && <Loader text="Генерируем для вас задание..." />}
                {error && !isLoading && <Card className="text-center text-red-400">{error} <Button onClick={() => fetchTask(true)} variant='secondary' className='mt-4'>Попробовать снова</Button></Card>}
                {!isLoading && !error && task && (
                    <Card className="w-full">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500">{task.title}</h2>
                            <span className="bg-slate-700 text-indigo-300 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full capitalize">{task.type}</span>
                        </div>
                        
                        {isInteractiveTask ? renderInteractiveTask() : renderQuizTask()}

                        <div className="mt-8 flex justify-end gap-4">
                            {showResults ? 
                                <Button onClick={() => fetchTask()} isLoading={isLoading}>Новое задание</Button> : 
                                <Button onClick={handleCheckAnswers} isLoading={isChecking} disabled={isInteractiveTask ? !userInput.trim() : Object.keys(selectedAnswers).length !== (task.questions?.length ?? 0)}>Проверить</Button>
                            }
                        </div>
                        {renderFeedbackSection()}
                    </Card>
                )}
            </main>
        </div>
    );
};

// --- ErrorBoundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error in ErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
          <Card className="max-w-2xl w-full text-center">
            <h1 className="text-3xl font-bold text-red-400 mb-4">Что-то пошло не так.</h1>
            <p className="text-slate-300 mb-6">Произошла непредвиденная ошибка в приложении. Пожалуйста, попробуйте перезагрузить страницу или сбросить сессию.</p>
            <div className="bg-slate-700 p-4 rounded-lg text-left overflow-auto max-h-60 mb-6">
                <code className="text-red-300 text-sm whitespace-pre-wrap">
                    {this.state.error?.toString()}
                </code>
            </div>
            <Button onClick={() => {
                localStorage.removeItem('geminiEnglishTutorData');
                window.location.reload();
            }}>Сбросить и перезагрузить</Button>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}


// --- App.tsx ---
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
            const savedDataRaw = localStorage.getItem('geminiEnglishTutorData');
            if (savedDataRaw) {
                const savedData: UserData = JSON.parse(savedDataRaw);
                if (savedData.apiKey) {
                    const service = new GeminiService(savedData.apiKey);
                    setGeminiService(service);
                    const today = getToday();
                    if (!savedData.taskHistory) savedData.taskHistory = [];
                    if (!savedData.dailyStats || savedData.dailyStats.date !== today) savedData.dailyStats = { date: today, completed: 0, correct: 0 };
                    if (!savedData.imageGeneration || savedData.imageGeneration.date !== today) savedData.imageGeneration = { count: 0, date: today };
                    if (!savedData.feedbackHistory) savedData.feedbackHistory = [];
                    setUserData(savedData);
                    setAppState(savedData.level ? AppState.LEARNING : AppState.WELCOME);
                }
            }
        } catch (e) {
            console.error("Failed to load data from storage", e);
            localStorage.removeItem('geminiEnglishTutorData');
            setAppState(AppState.AUTH);
        } finally {
            setIsInitializing(false);
        }
    }, []);

    const handleUserDataChange = (newUserData: UserData) => {
        setUserData(newUserData);
        localStorage.setItem('geminiEnglishTutorData', JSON.stringify(newUserData));
    };

    const handleAuth = (name: string, apiKey: string) => {
        try {
            setError(null);
            const service = new GeminiService(apiKey);
            setGeminiService(service);
            const today = getToday();
            const data: UserData = { user: { name, imageUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff` }, apiKey, level: null, imageGeneration: { count: 0, date: today }, taskHistory: [], dailyStats: { date: today, completed: 0, correct: 0 }, feedbackHistory: [] };
            handleUserDataChange(data);
            setAppState(AppState.WELCOME);
        } catch (err: any) {
            setError("Ошибка входа: " + err.message);
            setAppState(AppState.AUTH);
        }
    };
    
    const handleReset = () => {
        localStorage.removeItem('geminiEnglishTutorData');
        setUserData(null); setGeminiService(null); setAssessmentQuestions([]); setLevelUpQuestions([]); setError(null);
        setAppState(AppState.AUTH);
    };

    const handleStartAssessment = useCallback(async () => {
        if (!geminiService) { setError("Сервис не инициализирован."); setAppState(AppState.AUTH); return; }
        setAppState(AppState.ASSESSMENT_LOADING); setError(null);
        try {
            const questions = await geminiService.generateAssessmentTest();
            if (questions && questions.length > 0) { setAssessmentQuestions(questions); setAppState(AppState.ASSESSING); } 
            else { throw new Error("Не удалось загрузить вопросы для теста."); }
        } catch (err: any) { setError(err.message || 'Произошла неизвестная ошибка.'); setAppState(AppState.WELCOME); }
    }, [geminiService]);

    const handleAssessmentComplete = (level: CEFRLevel) => {
        if (!userData) return;
        handleUserDataChange({ ...userData, level });
        setAppState(AppState.RESULTS);
    };

    const handleTaskComplete = (results: boolean[]) => {
        if (!userData) return;
        const newHistory = [...userData.taskHistory, ...results].slice(-PROGRESS_HISTORY_LENGTH);
        const newDailyStats = { ...userData.dailyStats, completed: userData.dailyStats.completed + results.length, correct: userData.dailyStats.correct + results.filter(Boolean).length };
        handleUserDataChange({ ...userData, taskHistory: newHistory, dailyStats: newDailyStats });
    };

     const handleStartLevelUpTest = useCallback(async () => {
        if (!geminiService || !userData || !userData.level) return;
        const currentLevelIndex = CEFR_LEVELS_ORDER.indexOf(userData.level);
        if (currentLevelIndex >= CEFR_LEVELS_ORDER.length - 1) { alert("Поздравляем, вы достигли максимального уровня!"); return; }
        setAppState(AppState.LEVEL_UP_ASSESSMENT_LOADING); setError(null);
        try {
            const questions = await geminiService.generateLevelUpTest(userData.level);
            setLevelUpQuestions(questions);
            setAppState(AppState.LEVEL_UP_ASSESSING);
        } catch(err: any) { setError(err.message || 'Не удалось создать тест.'); setAppState(AppState.LEARNING); }
    }, [userData, geminiService]);

    const handleLevelUpTestComplete = (score: number) => {
        if (!userData || !userData.level) return;
        const isSuccess = score >= LEVEL_UP_PASS_PERCENTAGE;
        const currentLevelIndex = CEFR_LEVELS_ORDER.indexOf(userData.level);
        const newLevel = isSuccess ? CEFR_LEVELS_ORDER[currentLevelIndex + 1] || userData.level : userData.level;
        setLevelUpResult({ isSuccess, newLevel: isSuccess ? newLevel : null });
        handleUserDataChange({ ...userData, level: newLevel, taskHistory: [] });
        setAppState(AppState.LEVEL_UP_RESULTS);
    };
    
    const handleFeedbackSubmit = (feedback: string) => {
        if (!userData) return;
        const newFeedbackHistory = [...userData.feedbackHistory, feedback].slice(-20);
        handleUserDataChange({ ...userData, feedbackHistory: newFeedbackHistory });
    };

    const renderMainContent = () => {
        if (isInitializing) {
            return <div className="bg-slate-900 min-h-screen flex items-center justify-center"><Loader text="Загрузка приложения..." /></div>;
        }

        if (appState === AppState.AUTH || !userData) {
            return <AuthScreen onAuth={handleAuth} error={error} />;
        }

        let screenContent: React.ReactNode;
        switch (appState) {
            case AppState.WELCOME:
                screenContent = <WelcomeScreen user={userData.user} onStart={handleStartAssessment} />;
                break;
            case AppState.ASSESSMENT_LOADING:
                screenContent = <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Готовим для вас тест..." /></div>;
                break;
            case AppState.ASSESSING:
                screenContent = <Assessment questions={assessmentQuestions} onComplete={handleAssessmentComplete} />;
                break;
            case AppState.RESULTS:
                screenContent = userData.level 
                    ? <ResultsScreen level={userData.level} onStartLearning={() => setAppState(AppState.LEARNING)} /> 
                    : <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Анализ результатов..." /></div>;
                break;
            case AppState.LEARNING:
                screenContent = (geminiService) 
                    ? <LearningDashboard geminiService={geminiService} userData={userData} onUserDataChange={handleUserDataChange} onTaskComplete={handleTaskComplete} onStartLevelUpTest={handleStartLevelUpTest} onFeedbackSubmit={handleFeedbackSubmit} /> 
                    : <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Загрузка учебной панели..." /></div>;
                break;
            case AppState.LEVEL_UP_ASSESSMENT_LOADING:
                screenContent = <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Готовим тест на повышение уровня..." /></div>;
                break;
            case AppState.LEVEL_UP_ASSESSING:
                screenContent = <LevelUpAssessment questions={levelUpQuestions} onComplete={handleLevelUpTestComplete} />;
                break;
            case AppState.LEVEL_UP_RESULTS:
                screenContent = <LevelUpResultsScreen isSuccess={levelUpResult.isSuccess} newLevel={levelUpResult.newLevel} onContinue={() => { setAppState(AppState.LEARNING); setLevelUpQuestions([]); setLevelUpResult({isSuccess: false, newLevel: null}); }} />;
                break;
            default:
                // This is a safe fallback. It does NOT change state during render.
                screenContent = <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Перенаправление..." /></div>;
                break;
        }
        
        return (
            <div className="bg-slate-900 min-h-screen">
                <Header user={userData.user} onReset={handleReset} level={userData.level} dailyStats={userData.dailyStats}/>
                <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                    {screenContent}
                    {error && <div className="fixed bottom-5 right-5"><Card className="bg-red-500/20 border-red-500 text-red-300">{error}</Card></div>}
                </main>
            </div>
        );
    };
    
    return <ErrorBoundary>{renderMainContent()}</ErrorBoundary>;
};


// --- Mount the application ---
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);