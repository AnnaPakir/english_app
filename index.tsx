
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
    AUTH_LOADING, // Added for connection test
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

// Consolidated and updated task types
type TaskType = 'reading' | 'grammar' | 'image' | 'fill-in-the-blanks' | 'sentence-construction' | 'error-correction' | 'role-play';

interface LearningTask {
    type: TaskType;
    title: string;
    level: CEFRLevel;
    content: string; // Usage depends on type: reading text, image prompt, incorrect sentence, dialogue starter, etc.
    questions?: {
        question: string;
        options: string[];
        correctAnswer: string;
    }[];
    context?: string; // For role-play, error-correction
    constraints?: string; // For role-play, sentence-construction
    words?: string[]; // For sentence-construction
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
    taskHistory: boolean[]; // true for correct, false for incorrect
    dailyStats: {
        date: string; // YYYY-MM-DD
        completed: number;
        correct: number;
    };
    feedbackHistory: string[];
    globalInstructions: string[]; // NEW: Persistent user preferences
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

    async testConnection(): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await this.ai.models.generateContent({
                model: "gemini-2.5-flash-preview-04-17",
                contents: "test",
                config: { thinkingConfig: { thinkingBudget: 0 } }
            });
            // Changed to check response object structure for more reliability
            return { success: !!response?.text };
        } catch (error: any) {
            console.error("API Connection Test Failed:", error);
            
            const errorText = (error.message || '').toLowerCase();
            let errorMessage = "Проверьте ваш API ключ и его ограничения для веб-сайтов.";

            if (errorText.includes('api key not valid')) {
                errorMessage = "API ключ недействителен. Пожалуйста, проверьте его.";
            } else if (errorText.includes('quota') || errorText.includes('billing') || errorText.includes('rate limit')) {
                errorMessage = "Достигнут лимит использования API. Пожалуйста, проверьте лимиты в Google AI Studio или привяжите платежный аккаунт.";
            } else if (errorText.includes('fetch')) {
                 errorMessage = "Ошибка сети. Проверьте ваше интернет-соединение или настройки CORS для ключа.";
            }
            
            return { success: false, error: errorMessage };
        }
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
        
        IMPORTANT: Your entire response must be ONLY the valid JSON array, with no other text, explanations, or markdown fences. The JSON MUST be perfect and parsable. Do not include a trailing comma after the last object in the array.
        `;
        try {
            const response: GenerateContentResponse = await this.ai.models.generateContent({ model: "gemini-2.5-flash-preview-04-17", contents: prompt, config: { responseMimeType: "application/json", temperature: 0.3 } });
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
        The questions must be difficult and cover a wide range of grammar, vocabulary, and reading comprehension topics appropriate for the ${level} level.

        For each question, provide:
        - A clear question.
        - 4 multiple-choice options.
        - The correct answer.
        - The 'level' field for all questions MUST be exactly "${level}".

        Return the result as a JSON array of objects. Each object must have this exact structure:
        { "question": "string", "options": ["string", "string", "string", "string"], "correctAnswer": "string", "level": "${level}" }

        IMPORTANT: Your entire response must be ONLY the valid JSON array, with no other text, explanations, or markdown fences. The JSON MUST be perfect and parsable. Do not include a trailing comma after the last object in the array.`;
        try {
             const response: GenerateContentResponse = await this.ai.models.generateContent({ model: "gemini-2.5-flash-preview-04-17", contents: prompt, config: { responseMimeType: "application/json", temperature: 0.2 } });
            const questions = this.parseJsonResponse<AssessmentQuestion[]>(response.text);
            if (!questions || !Array.isArray(questions) || questions.length < LEVEL_UP_TEST_QUESTIONS) throw new Error("Could not generate a valid level-up test.");
            return questions.slice(0, LEVEL_UP_TEST_QUESTIONS);
        } catch (error) {
            console.error(`Error generating level-up test for ${level}:`, error);
            throw new Error("Не удалось сгенерировать тест. AI вернул некорректные данные. Попробуйте еще раз.");
        }
    }

    async generateLearningTask(level: CEFRLevel, feedbackHistory: string[], isPreLevelUp: boolean, globalInstructions: string[]): Promise<LearningTask | null> {
        const globalInstructionsPrompt = globalInstructions.length > 0
            ? `
PERMANENT USER PREFERENCES: The user has set the following long-term preferences for their learning. These are the most important rules. You MUST follow them for ALL tasks you generate.
${globalInstructions.map(instr => `- ${instr}`).join('\n')}`
            : '';
    
        const feedbackPrompt = feedbackHistory.length > 0
            ? `
ONE-TIME REQUEST/FEEDBACK: The user has provided the following recent feedback or direct requests. You should try to incorporate this into the current task. If this conflicts with a permanent preference, the permanent preference takes priority.
- Prioritize fulfilling any explicit user requests for the current task (e.g., "User explicitly asked for...").
- Here is the user's feedback/request history (most recent first):
${feedbackHistory.slice(-5).reverse().map(f => `- "${f}"`).join('\n')}` : '';

        const difficultyPrompt = isPreLevelUp
            ? `
CRITICAL INSTRUCTION: The user is preparing for a level-up test. The task MUST be more challenging than a typical ${level} task. This instruction is very important for the current task.`
            : '';

        const prompt = `
You are an expert AI English tutor. Your goal is to create a single, engaging, and methodologically sound English learning task for a user at the ${level} CEFR level.

${globalInstructionsPrompt}
${difficultyPrompt}
${feedbackPrompt}

Choose ONE of the following task types: 'fill-in-the-blanks', 'sentence-construction', 'error-correction', 'role-play', 'image', 'reading', 'grammar'.
Return the result as a single, perfectly-formed JSON object. Your entire response MUST be ONLY the JSON object, without any surrounding text or markdown fences. The JSON object MUST include a "level": "${level}" field.

Here are the required structures for each type. Follow them strictly.

1.  **For 'fill-in-the-blanks', 'reading', 'grammar' (Quiz-based):**
    - Structure: { "type": "string", "title": "string", "level": "${level}", "content": "The main text. For 'fill-in-the-blanks', use '___' for the gap.", "questions": [{ "question": "string", "options": ["string", "string", "string"], "correctAnswer": "string" }] }
    - Example for 'fill-in-the-blanks': { "type": "fill-in-the-blanks", "title": "Past Tense Practice", "level": "${level}", "content": "I ___ to the store yesterday.", "questions": [{ "question": "Fill in the blank.", "options": ["go", "went", "gone"], "correctAnswer": "went" }] }

2.  **For 'image' (Visual Quiz):**
    - First, create a rich, descriptive prompt for an image generation model. This prompt should describe a scene with multiple details.
    - Second, create a multiple-choice question about the scene described in the image prompt.
    - Structure: { "type": "image", "title": "Image-based Question", "level": "${level}", "content": "A creative and descriptive prompt for an image generation model (e.g., 'A detailed oil painting of a friendly robot trying to cook spaghetti in a messy, futuristic kitchen. The robot is wearing a chef's hat and has pasta sauce on its face. A small cat is watching from a chair.').", "questions": [{ "question": "What is the cat doing in the scene?", "options": ["Cooking with the robot", "Watching from a chair", "Sleeping on the floor"], "correctAnswer": "Watching from a chair" }] }

3.  **For 'role-play' (Interactive Dialogue):**
    - Create a realistic scenario where the user needs to achieve a goal.
    - Structure: { "type": "role-play", "title": "Role-play: [Scenario Name]", "level": "${level}", "context": "A description of the scenario and the user's role (e.g., 'You are at a hotel reception. You need to check in for your reservation.').", "content": "The first line from the other character (the AI). (e.g., 'Good evening! How can I help you?')", "constraints": "A clear goal for the user in the conversation (e.g., 'Check in, ask what time breakfast is, and request a late check-out.')." }

4.  **For 'error-correction' (Interactive Editing):**
    - Provide a single English sentence with a clear grammatical or vocabulary error appropriate for the user's level.
    - Structure: { "type": "error-correction", "title": "Find and Fix the Mistake", "level": "${level}", "content": "A single English sentence containing one clear error (e.g., 'She have two cats.').", "context": "Optional context for the sentence (e.g., 'Your friend is talking about her pets.')." }

5.  **For 'sentence-construction' (Interactive Grammar Practice):**
    - Give the user a set of words to form a coherent sentence or question.
    - Structure: { "type": "sentence-construction", "title": "Make a Sentence", "level": "${level}", "content": "A short instruction (e.g., 'Create a question about hobbies using all the words below.').", "words": ["you", "like", "what", "do", "to", "do"], "constraints": "Optional constraints (e.g., 'The sentence must be a question.')." }

IMPORTANT: Ensure the generated JSON is valid. Do not add trailing commas. Respond ONLY with the JSON object.`;
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
        let taskContextPrompt = "";
        switch (task.type) {
            case 'role-play':
                taskContextPrompt = `
- Scenario Context: "${task.context}"
- AI's First Line: "${task.content}"
- User's Goal: "${task.constraints}"
- Evaluation criteria: Did the user respond appropriately to the AI's line and work towards their goal? Is the grammar correct for their level?`;
                break;
            case 'error-correction':
                taskContextPrompt = `
- Incorrect sentence to be fixed: "${task.content}"
- Evaluation criteria: Did the user correctly identify and fix the error? Is the resulting sentence grammatically correct? The correct answer should be a single, complete sentence.`;
                break;
            case 'sentence-construction':
                taskContextPrompt = `
- Words to use: ${task.words?.join(' / ')}
- Instructions: "${task.content}"
- Constraints: "${task.constraints}"
- Evaluation criteria: Did the user use all the words correctly to form a sentence that meets the constraints?`;
                break;
            default:
                return { isCorrect: false, feedback: "Неверный тип задания для оценки." };
        }

        const prompt = `
You are an expert AI English tutor. A learner at the ${task.level} level was given a task.
Evaluate their response based on the task's specific requirements.
The feedback MUST be in simple, encouraging, clear Russian. It should explain what was good and what could be improved.
Return your evaluation as a JSON object with this exact structure: { "isCorrect": boolean, "feedback": "string" }.
The \`isCorrect\` field should be \`true\` only if the user's response is grammatically correct and fully meets all task constraints.

- Task Type: ${task.type}
- User's Response: "${userInput}"

Here is the specific task information:
${taskContextPrompt}

Based on this, evaluate the user's response. Remember to be supportive.
Your entire response must be ONLY the JSON object.`;

        try {
            const response = await this.ai.models.generateContent({ model: "gemini-2.5-flash-preview-04-17", contents: prompt, config: { responseMimeType: "application/json", temperature: 0.3 } });
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
            throw new Error("Failed to generate image. The model may have refused the prompt or an API error occurred.");
        }
    }

    async getHelpFromGemini(query: string, level: CEFRLevel): Promise<string> {
        const prompt = `You are a friendly and supportive AI English tutor. A user at the ${level} level has a question or a request for their next lesson.
        User's request: "${query}"
        Provide a helpful and concise answer in simple Russian. You can explain a grammar rule, define a word, or confirm that their next task will be about their request. The answer should be encouraging.
        For example, if the user asks "I want to practice phrasal verbs", you could respond with "Отличная идея! Следующее задание будет посвящено фразовым глаголам. Удачи!".`;
        try {
            const response = await this.ai.models.generateContent({ model: "gemini-2.5-flash-preview-04-17", contents: prompt, config: { temperature: 0.7 } });
            return response.text;
        } catch (error) {
            console.error("Error getting help from Gemini:", error);
            return "К сожалению, не удалось получить ответ от Gemini. Попробуйте еще раз.";
        }
    }
}

// --- From components/AuthScreen.tsx ---
interface AuthScreenProps { onAuth: (name: string, apiKey: string) => void; error: string | null; isLoading: boolean; }
const AuthScreen: React.FC<AuthScreenProps> = ({ onAuth, error, isLoading }) => {
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
                    {error && <p className="text-red-400 text-sm py-2">{error}</p>}
                    <Button type="submit" variant="primary" className="w-full text-lg py-3" disabled={!name.trim() || !apiKey.trim() || isLoading} isLoading={isLoading}>
                        {isLoading ? 'Проверка...' : 'Войти'}
                    </Button>
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
interface ProgressTrackerProps {
    history: boolean[];
    isPreLevelUp: boolean;
}
const ProgressTracker: React.FC<ProgressTrackerProps> = ({ history, isPreLevelUp }) => {
    const correctCount = history.filter(h => h).length;
    const progressPercentage = Math.min((correctCount / PROGRESS_UNLOCK_THRESHOLD) * 100, 100);
    return (
        <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-lg p-4">
            <div className="flex justify-between items-center mb-2"><h3 className="font-bold text-slate-200">Прогресс к следующему уровню</h3><span className="text-lg font-mono font-bold text-indigo-300">{correctCount} / {PROGRESS_UNLOCK_THRESHOLD}</span></div>
            <p className="text-sm text-slate-400 mb-3">Правильно ответьте на {PROGRESS_UNLOCK_THRESHOLD} из последних {PROGRESS_HISTORY_LENGTH} заданий, чтобы разблокировать тест на повышение уровня.</p>
            <div className="w-full bg-slate-700 rounded-full h-4 relative overflow-hidden"><div className="bg-gradient-to-r from-teal-400 to-indigo-500 h-4 rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercentage}%` }}></div></div>
            {isPreLevelUp && (
                <div className="mt-3 text-center text-sm text-yellow-300 bg-yellow-900/40 border border-yellow-800/60 rounded-lg py-2 px-3">
                    <p>🚀 <strong>Готовимся к экзамену!</strong> Задания становятся сложнее, чтобы лучше подготовить вас к тесту.</p>
                </div>
            )}
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
        if (option === questions[currentQuestionIndex].correctAnswer) {
            setCorrectAnswersCount(prev => prev + 1);
        }
        setTimeout(() => {
            if (currentQuestionIndex < questions.length) {
                setCurrentQuestionIndex(prev => prev + 1);
                setSelectedAnswer(null);
            }
        }, 800); // Increased delay to see the result color
    };

    const getButtonClassForLevelUp = (option: string) => {
        if (!selectedAnswer) return 'bg-slate-700 hover:bg-slate-600';
        const isCorrect = option === questions[currentQuestionIndex].correctAnswer;
        const isSelected = option === selectedAnswer;
        if (isCorrect) return 'bg-green-600'; 
        if (isSelected && !isCorrect) return 'bg-red-600';
        return 'bg-slate-700 opacity-50';
    };

    if (currentQuestionIndex >= questions.length) {
        return <div className="flex flex-col items-center justify-center min-h-screen p-4"><Loader text="Подсчет результатов..." /></div>;
    }
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) {
       return <div className="flex flex-col items-center justify-center min-h-screen p-4"><Loader text="Загрузка вопроса..." /></div>;
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <Card className="w-full max-w-2xl">
                <div className="mb-6"><h2 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500 mb-2">Тест на повышение уровня</h2><p className="text-center text-slate-400">Для прохождения нужно ответить правильно на {LEVEL_UP_PASS_PERCENTAGE * 100}% вопросов.</p></div>
                <div className="mb-4">
                    <div className="flex justify-between mb-1"><span className="text-base font-medium text-indigo-400">Прогресс</span><span className="text-sm font-medium text-indigo-400">{currentQuestionIndex + 1} / {questions.length}</span></div>
                    <div className="w-full bg-slate-700 rounded-full h-2.5"><div className="bg-indigo-600 h-2.5 rounded-full transition-width duration-300" style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}></div></div>
                </div>
                <h3 className="text-2xl font-bold text-slate-100 mb-2">{`Вопрос ${currentQuestionIndex + 1}`}</h3><p className="text-slate-300 text-lg mb-6">{currentQuestion.question}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {currentQuestion.options.map((option, index) => (
                        <button key={index} onClick={() => handleAnswerSelect(option)} disabled={!!selectedAnswer} className={`w-full p-4 rounded-lg text-left transition-colors duration-300 ${getButtonClassForLevelUp(option)}`}>{option}</button>
                    ))}
                </div>
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
interface LearningDashboardProps { geminiService: GeminiService; userData: UserData; onTaskComplete: (results: boolean[]) => void; onStartLevelUpTest: () => void; onFeedbackSubmit: (feedback: string) => void; onGlobalInstructionsChange: (instructions: string[]) => void;}
const LearningDashboard: React.FC<LearningDashboardProps> = ({ geminiService, userData, onTaskComplete, onStartLevelUpTest, onFeedbackSubmit, onGlobalInstructionsChange }) => {
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
    const [isTaskImageLoading, setIsTaskImageLoading] = useState(false);
    const [taskImageUrl, setTaskImageUrl] = useState<string | null>(null);
    const [showFeedbackForm, setShowFeedbackForm] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");
    const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
    
    // State for "Ask Gemini" modal
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    const [helpQuery, setHelpQuery] = useState("");
    const [isHelpLoading, setIsHelpLoading] = useState(false);
    const [helpResponse, setHelpResponse] = useState<string | null>(null);
    
    // State for Preferences Modal
    const [isPreferencesModalOpen, setIsPreferencesModalOpen] = useState(false);
    const [newInstruction, setNewInstruction] = useState("");


    const INTERACTIVE_TASK_TYPES: TaskType[] = ['sentence-construction', 'error-correction', 'role-play'];

    const correctCount = userData.taskHistory.filter(Boolean).length;
    const canAttemptLevelUp = correctCount >= PROGRESS_UNLOCK_THRESHOLD;
    const preLevelUpThreshold = 50;
    const isPreLevelUp = !canAttemptLevelUp && correctCount >= preLevelUpThreshold;

    const fetchTask = useCallback(async (isRetry: boolean = false) => {
        if (!isRetry) {
            setTask(null); setSelectedAnswers({}); setShowResults(false); setTaskResults([]); setExplanations({}); setIsChecking(false); setTaskImageUrl(null); setIsTaskImageLoading(false); setUserInput(""); setEvaluation(null); setShowFeedbackForm(false); setFeedbackText(""); setFeedbackSubmitted(false);
            setIsLoading(true); setError(null);
        } else { setError(null); setIsLoading(true); }
        try {
            const newTask = await geminiService.generateLearningTask(userData.level!, userData.feedbackHistory, isPreLevelUp, userData.globalInstructions);
            if (!newTask) throw new Error("Received empty task from API.");
            
            if (newTask.type === 'image' && newTask.content) {
                setIsTaskImageLoading(true);
                setTaskImageUrl(null);
                setTask(newTask);
                try {
                    const imageUrl = await geminiService.generateImage(newTask.content);
                    setTaskImageUrl(imageUrl);
                } catch (err: any) {
                    setError(err.message || "Не удалось сгенерировать изображение для задания.");
                } finally {
                    setIsTaskImageLoading(false);
                }
            } else {
                setTask(newTask);
            }
        } catch (err: any) { setError(err.message || 'An unknown error occurred.'); } 
        finally { setIsLoading(false); }
    }, [userData.level, userData.feedbackHistory, userData.globalInstructions, geminiService, isPreLevelUp]);
    
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
    
    const handleHelpModalClose = () => {
        setIsHelpModalOpen(false);
        setHelpQuery("");
        setHelpResponse(null);
        setIsHelpLoading(false);
    };

    const handleHelpSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!helpQuery.trim() || !userData.level) return;
        setIsHelpLoading(true);
        setHelpResponse(null);
        const response = await geminiService.getHelpFromGemini(helpQuery, userData.level);
        setHelpResponse(response);
        // This influences the next task
        onFeedbackSubmit(`User explicitly asked for a task about: "${helpQuery.trim()}"`);
        setIsHelpLoading(false);
        setHelpQuery("");
    };

    const handleAddInstruction = () => {
        if (newInstruction.trim()) {
            onGlobalInstructionsChange([...userData.globalInstructions, newInstruction.trim()]);
            setNewInstruction("");
        }
    };

    const handleDeleteInstruction = (indexToDelete: number) => {
        onGlobalInstructionsChange(userData.globalInstructions.filter((_, index) => index !== indexToDelete));
    };

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
                {task.type !== 'image' && <p className="text-slate-300 text-lg mb-6 whitespace-pre-wrap">{task.content}</p>}
                
                {task.type === 'image' && (
                    <div className="mb-6 text-center">
                        {isTaskImageLoading && <Loader text="Магия Imagen в действии..." />}
                        {error && !isTaskImageLoading && <p className="text-red-400">{error}</p>}
                        {taskImageUrl && <img src={taskImageUrl} alt="Generated art for the task" className="rounded-lg mx-auto shadow-lg max-w-full h-auto mb-4" />}
                    </div>
                )}

                <div className="space-y-6">
                    {task.questions.map((q, qIndex) => (
                        <div key={qIndex}>
                            <h3 className="font-semibold text-slate-200 mb-3">{q.question}</h3>
                            <div className="grid grid-cols-1 gap-3">
                                {q.options.map((option, oIndex) => <button key={oIndex} onClick={() => !showResults && setSelectedAnswers(prev => ({ ...prev, [qIndex]: option }))} disabled={showResults || (task.type === 'image' && (!taskImageUrl || isTaskImageLoading))} className={`p-3 rounded-lg text-left transition-colors duration-300 ${getOptionClass(qIndex, option)}`}>{option}</button>)}
                            </div>
                            {showResults && explanations[qIndex] && <div className="mt-3 p-3 bg-red-900/50 border border-red-700/50 rounded-lg"><p className="text-red-300">{explanations[qIndex]}</p></div>}
                        </div>
                    ))}
                </div>
            </>
        );
    };

    const renderInteractiveTask = () => {
        if (!task) return null;

        const getContextDescription = () => {
            switch (task.type) {
                case 'role-play':
                    return (
                        <div className="text-slate-400 mb-4 space-y-2">
                            <p><strong>Сценарий:</strong> {task.context}</p>
                            <p><strong>Ваша задача:</strong> {task.constraints}</p>
                        </div>
                    );
                case 'error-correction':
                     return (
                        <div className="text-slate-400 mb-2 space-y-1">
                            <p><strong>Задание:</strong> Найдите и исправьте ошибку в предложении ниже.</p>
                            {task.context && <p><strong>Контекст:</strong> {task.context}</p>}
                        </div>
                    );
                case 'sentence-construction':
                    return (
                        <div className="text-slate-400 mb-4 space-y-2">
                            <p><strong>Задание:</strong> {task.content}</p>
                            <p className="font-medium text-slate-300">Используйте эти слова:</p>
                            <div className="flex flex-wrap gap-2">{task.words?.map((word, i) => <span key={i} className="font-mono text-indigo-300 bg-slate-700/50 px-2 py-1 rounded-md border border-slate-600">{word}</span>)}</div>
                            {task.constraints && <p><strong>Условие:</strong> {task.constraints}</p>}
                        </div>
                    );
                default: return null;
            }
        }

        return (
            <div>
                <div className="mb-4">{getContextDescription()}</div>
                {task.type === 'role-play' && (<div className="mb-4 p-3 border-l-4 border-indigo-500 bg-slate-900/50"><p className="font-semibold">Собеседник:</p><p className="text-slate-300 italic">"{task.content}"</p></div>)}
                {task.type === 'error-correction' && (
                    <div className="mb-4">
                        <p className="text-sm font-semibold text-slate-500">ПРЕДЛОЖЕНИЕ С ОШИБКОЙ</p>
                        <p className="text-slate-300 p-3 bg-slate-900/50 rounded-md mt-1 italic">{task.content}</p>
                    </div>
                )}
                <label htmlFor="user-input" className="block text-sm font-medium text-slate-300 mb-2">Ваш ответ:</label>
                <textarea id="user-input" value={userInput} onChange={(e) => setUserInput(e.target.value)} disabled={showResults} rows={4} className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-70" placeholder="Напишите здесь..."/>
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
                <ProgressTracker history={userData.taskHistory} isPreLevelUp={isPreLevelUp} />
                {(canAttemptLevelUp) && (
                     <Card className="mt-4 text-center bg-indigo-900/50 border-indigo-700">
                        <h3 className="text-xl font-bold text-white">Поздравляем!</h3>
                        <p className="text-indigo-200 mt-2 mb-4">Вы готовы проверить свои знания и перейти на следующий уровень?</p>
                        <Button onClick={onStartLevelUpTest} variant="primary">Пройти тест на повышение</Button>
                     </Card>
                )}
            </header>
            
            {!canAttemptLevelUp && (
                <div className="mb-6">
                    <Card className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 sm:p-6">
                        <div>
                            <h3 className="font-bold text-slate-200">Настройте свое обучение</h3>
                            <p className="text-sm text-slate-400 mt-1">Задайте тему для следующего задания или установите постоянные предпочтения.</p>
                        </div>
                        <div className='flex gap-2 flex-col sm:flex-row'>
                            <Button onClick={() => setIsHelpModalOpen(true)} variant="secondary" className="flex-shrink-0">Спросить Gemini</Button>
                            <Button onClick={() => setIsPreferencesModalOpen(true)} variant="ghost" className="flex-shrink-0">Мои предпочтения</Button>
                        </div>
                    </Card>
                </div>
            )}

            <main>
                {isLoading && <Loader text="Генерируем для вас задание..." />}
                {error && !isLoading && !task && <Card className="text-center text-red-400">{error} <Button onClick={() => fetchTask(true)} variant='secondary' className='mt-4'>Попробовать снова</Button></Card>}
                {!isLoading && task && (
                    <Card className="w-full">
                        <div className="flex justify-between items-start mb-4">
                            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500 flex-1 pr-2">{task.title}</h2>
                            <span className="bg-slate-700 text-indigo-300 text-xs font-medium whitespace-nowrap px-2.5 py-0.5 rounded-full capitalize">{task.type.replace(/-/g, ' ')}</span>
                        </div>
                        
                        {isInteractiveTask ? renderInteractiveTask() : renderQuizTask()}

                        <div className="mt-8 flex justify-end gap-4">
                            {showResults ? 
                                <Button onClick={() => fetchTask()} isLoading={isLoading}>Новое задание</Button> : 
                                <Button 
                                    onClick={handleCheckAnswers} 
                                    isLoading={isChecking} 
                                    disabled={
                                        isTaskImageLoading ||
                                        (isInteractiveTask ? !userInput.trim() : Object.keys(selectedAnswers).length !== (task.questions?.length ?? 0))
                                    }
                                >
                                    Проверить
                                </Button>
                            }
                        </div>
                        {renderFeedbackSection()}
                    </Card>
                )}
            </main>

            {/* Help (One-off Request) Modal */}
            {isHelpModalOpen && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
                    <Card className="w-full max-w-lg relative">
                        <button onClick={handleHelpModalClose} className="absolute top-3 right-4 text-slate-500 hover:text-white transition-colors text-2xl font-bold leading-none p-1" aria-label="Закрыть">&times;</button>
                        <h3 className="text-xl font-bold text-slate-100 mb-4 pr-8">Задать вопрос Gemini</h3>

                        {!helpResponse && !isHelpLoading && (
                            <form onSubmit={handleHelpSubmit}>
                                <p className="text-slate-400 mb-4">Что бы вы хотели изучить? Ваше следующее задание будет основано на этом.</p>
                                <textarea 
                                    value={helpQuery}
                                    onChange={(e) => setHelpQuery(e.target.value)}
                                    rows={4}
                                    className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    placeholder="Например: 'Хочу попрактиковать неправильные глаголы' или 'В чем разница между will и going to?'"
                                />
                                <div className="mt-4 flex justify-end">
                                    <Button type="submit" isLoading={isHelpLoading} disabled={!helpQuery.trim()}>Отправить</Button>
                                </div>
                            </form>
                        )}
                        
                        {isHelpLoading && <Loader text="Думаем..." />}

                        {helpResponse && (
                            <div>
                                <p className="text-slate-400 mb-4">Вот ответ от Gemini:</p>
                                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 max-h-60 overflow-y-auto">
                                    <p className="text-slate-300 whitespace-pre-wrap">{helpResponse}</p>
                                </div>
                                <div className="mt-6 text-right">
                                    <Button onClick={handleHelpModalClose}>Понятно!</Button>
                                </div>
                            </div>
                        )}
                    </Card>
                </div>
            )}
            
            {/* Preferences (Persistent Instructions) Modal */}
            {isPreferencesModalOpen && (
                 <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
                    <Card className="w-full max-w-2xl relative">
                        <button onClick={() => setIsPreferencesModalOpen(false)} className="absolute top-3 right-4 text-slate-500 hover:text-white transition-colors text-2xl font-bold leading-none p-1" aria-label="Закрыть">&times;</button>
                        <h3 className="text-xl font-bold text-slate-100 mb-1 pr-8">Мои предпочтения</h3>
                        <p className="text-slate-400 mb-6">Эти инструкции будут влиять на все задания, которые генерирует Gemini.</p>
                        
                        <div className="mb-6">
                            <h4 className="font-semibold text-slate-300 mb-3">Текущие предпочтения</h4>
                            {userData.globalInstructions.length > 0 ? (
                                <ul className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                    {userData.globalInstructions.map((instr, index) => (
                                        <li key={index} className="flex justify-between items-center bg-slate-700/50 p-3 rounded-lg">
                                            <p className="text-slate-300 mr-4">{instr}</p>
                                            <button onClick={() => handleDeleteInstruction(index)} className="text-slate-500 hover:text-red-400 transition-colors flex-shrink-0" aria-label="Удалить">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.58.22-2.365.468a.75.75 0 1 0 .53 1.437c.786-.246 1.572-.394 2.365-.468v.443A2.75 2.75 0 0 0 8.75 8h2.5A2.75 2.75 0 0 0 14 5.25v-.443c.795.077 1.58.22 2.365.468a.75.75 0 1 0 .53-1.437c-.786-.246-1.572-.394-2.365-.468v-.443A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 10a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5ZM13.25 10a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5Z" clipRule="evenodd" /><path d="M5.75 10.75a.75.75 0 0 0-1.5 0v6.5c0 .966.784 1.75 1.75 1.75h8.5a1.75 1.75 0 0 0 1.75-1.75v-6.5a.75.75 0 0 0-1.5 0v6.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-6.5Z" clipRule="evenodd" /></svg>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-slate-500 italic text-center py-4">Вы пока не добавили предпочтений.</p>
                            )}
                        </div>

                        <div className="border-t border-slate-700 pt-6">
                            <h4 className="font-semibold text-slate-300 mb-3">Добавить новое предпочтение</h4>
                             <textarea 
                                value={newInstruction}
                                onChange={(e) => setNewInstruction(e.target.value)}
                                rows={3}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                placeholder="Например: 'Больше заданий на разговорную речь' или 'Избегать тем о политике'"
                            />
                            <div className="mt-4 flex justify-end gap-2">
                                <Button onClick={handleAddInstruction} disabled={!newInstruction.trim()}>Добавить</Button>
                                <Button onClick={() => setIsPreferencesModalOpen(false)} variant="secondary">Готово</Button>
                            </div>
                        </div>
                    </Card>
                </div>
            )}
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
    const [authError, setAuthError] = useState<string | null>(null);
    const [generalError, setGeneralError] = useState<string | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);

    const getToday = () => new Date().toISOString().split('T')[0];

    useEffect(() => {
        const initializeApp = async () => {
            try {
                const savedDataRaw = localStorage.getItem('geminiEnglishTutorData');
                if (savedDataRaw) {
                    const savedData: UserData = JSON.parse(savedDataRaw);
                    if (savedData.apiKey) {
                        const service = new GeminiService(savedData.apiKey);
                        const connectionTest = await service.testConnection();

                        if (connectionTest.success) {
                            setGeminiService(service);
                            const today = getToday();
                            if (!savedData.taskHistory) savedData.taskHistory = [];
                            if (!savedData.dailyStats || savedData.dailyStats.date !== today) savedData.dailyStats = { date: today, completed: 0, correct: 0 };
                            if (!savedData.feedbackHistory) savedData.feedbackHistory = [];
                            if (!savedData.globalInstructions) savedData.globalInstructions = []; // Initialize if not present
                            setUserData(savedData);
                            setAppState(savedData.level ? AppState.LEARNING : AppState.WELCOME);
                        } else {
                            // The saved key is no longer valid or fails from this origin
                            localStorage.removeItem('geminiEnglishTutorData');
                            setAuthError(connectionTest.error || "Сохраненный ключ больше не действителен.");
                            setAppState(AppState.AUTH);
                        }
                    } else {
                         setAppState(AppState.AUTH);
                    }
                } else {
                     setAppState(AppState.AUTH);
                }
            } catch (e) {
                console.error("Failed to load data from storage", e);
                localStorage.removeItem('geminiEnglishTutorData');
                setAppState(AppState.AUTH);
            } finally {
                setIsInitializing(false);
            }
        };
        initializeApp();
    }, []);

    const handleUserDataChange = useCallback((newUserData: UserData) => {
        setUserData(newUserData);
        localStorage.setItem('geminiEnglishTutorData', JSON.stringify(newUserData));
    }, []);

    const handleAuth = useCallback(async (name: string, apiKey: string) => {
        setAppState(AppState.AUTH_LOADING);
        setAuthError(null);
        try {
            const service = new GeminiService(apiKey);
            const connectionTest = await service.testConnection();

            if (connectionTest.success) {
                setGeminiService(service);
                const today = getToday();
                const data: UserData = {
                    user: { name, imageUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff` },
                    apiKey,
                    level: null,
                    taskHistory: [],
                    dailyStats: { date: today, completed: 0, correct: 0 },
                    feedbackHistory: [],
                    globalInstructions: []
                };
                handleUserDataChange(data);
                setAppState(AppState.WELCOME);
            } else {
                setAuthError(connectionTest.error || "Не удалось подключиться. Проверьте API ключ.");
                setGeminiService(null);
                setAppState(AppState.AUTH);
            }
        } catch (err: any) {
            setAuthError("Критическая ошибка при инициализации: " + err.message);
            setAppState(AppState.AUTH);
        }
    }, [handleUserDataChange]);
    
    const handleReset = useCallback(() => {
        localStorage.removeItem('geminiEnglishTutorData');
        setUserData(null); setGeminiService(null); setAssessmentQuestions([]); setLevelUpQuestions([]); setAuthError(null); setGeneralError(null);
        setAppState(AppState.AUTH);
    }, []);

    const handleStartAssessment = useCallback(async () => {
        if (!geminiService) { setGeneralError("Сервис не инициализирован."); setAppState(AppState.AUTH); return; }
        setAppState(AppState.ASSESSMENT_LOADING); setGeneralError(null);
        try {
            const questions = await geminiService.generateAssessmentTest();
            if (questions && questions.length > 0) { setAssessmentQuestions(questions); setAppState(AppState.ASSESSING); } 
            else { throw new Error("Не удалось загрузить вопросы для теста."); }
        } catch (err: any) { setGeneralError(err.message || 'Произошла неизвестная ошибка.'); setAppState(AppState.WELCOME); }
    }, [geminiService]);

    const handleAssessmentComplete = useCallback((level: CEFRLevel) => {
        if (!userData) return;
        handleUserDataChange({ ...userData, level });
        setAppState(AppState.RESULTS);
    }, [userData, handleUserDataChange]);

    const handleTaskComplete = useCallback((results: boolean[]) => {
        if (!userData) return;
        const newHistory = [...userData.taskHistory, ...results].slice(-PROGRESS_HISTORY_LENGTH);
        const newDailyStats = { ...userData.dailyStats, completed: userData.dailyStats.completed + results.length, correct: userData.dailyStats.correct + results.filter(Boolean).length };
        handleUserDataChange({ ...userData, taskHistory: newHistory, dailyStats: newDailyStats });
    }, [userData, handleUserDataChange]);

     const handleStartLevelUpTest = useCallback(async () => {
        if (!geminiService || !userData || !userData.level) return;
        const currentLevelIndex = CEFR_LEVELS_ORDER.indexOf(userData.level);
        if (currentLevelIndex >= CEFR_LEVELS_ORDER.length - 1) { alert("Поздравляем, вы достигли максимального уровня!"); return; }
        setAppState(AppState.LEVEL_UP_ASSESSMENT_LOADING); setGeneralError(null);
        try {
            const questions = await geminiService.generateLevelUpTest(userData.level);
            setLevelUpQuestions(questions);
            setAppState(AppState.LEVEL_UP_ASSESSING);
        } catch(err: any) { setGeneralError(err.message || 'Не удалось создать тест.'); setAppState(AppState.LEARNING); }
    }, [userData, geminiService]);

    const handleLevelUpTestComplete = useCallback((score: number) => {
        if (!userData || !userData.level) return;
        const isSuccess = score >= LEVEL_UP_PASS_PERCENTAGE;
        const currentLevelIndex = CEFR_LEVELS_ORDER.indexOf(userData.level);
        const newLevel = isSuccess ? CEFR_LEVELS_ORDER[currentLevelIndex + 1] || userData.level : userData.level;
        setLevelUpResult({ isSuccess, newLevel: isSuccess ? newLevel : null });
        handleUserDataChange({ ...userData, level: newLevel, taskHistory: [] });
        setAppState(AppState.LEVEL_UP_RESULTS);
    }, [userData, handleUserDataChange]);
    
    const handleFeedbackSubmit = useCallback((feedback: string) => {
        if (!userData) return;
        const newFeedbackHistory = [...userData.feedbackHistory, feedback].slice(-20);
        handleUserDataChange({ ...userData, feedbackHistory: newFeedbackHistory });
    }, [userData, handleUserDataChange]);
    
    const handleGlobalInstructionsChange = useCallback((instructions: string[]) => {
        if (!userData) return;
        handleUserDataChange({ ...userData, globalInstructions: instructions });
    }, [userData, handleUserDataChange]);

    if (isInitializing) {
        return <div className="bg-slate-900 min-h-screen flex items-center justify-center"><Loader text="Загрузка приложения..." /></div>;
    }

    if (appState === AppState.AUTH || appState === AppState.AUTH_LOADING || !userData) {
        return <AuthScreen onAuth={handleAuth} error={authError} isLoading={appState === AppState.AUTH_LOADING} />;
    }

    // Screens that don't need the main header/layout
    if (appState === AppState.ASSESSING) {
        return <Assessment questions={assessmentQuestions} onComplete={handleAssessmentComplete} />;
    }
    if (appState === AppState.RESULTS) {
         return userData.level 
                ? <ResultsScreen level={userData.level} onStartLearning={() => setAppState(AppState.LEARNING)} /> 
                : <div className="bg-slate-900 min-h-screen flex items-center justify-center"><Loader text="Анализ результатов..." /></div>;
    }
     if (appState === AppState.LEVEL_UP_ASSESSING) {
        return <LevelUpAssessment questions={levelUpQuestions} onComplete={handleLevelUpTestComplete} />;
    }
    if (appState === AppState.LEVEL_UP_RESULTS) {
        return <LevelUpResultsScreen isSuccess={levelUpResult.isSuccess} newLevel={levelUpResult.newLevel} onContinue={() => { setAppState(AppState.LEARNING); setLevelUpQuestions([]); setLevelUpResult({isSuccess: false, newLevel: null}); }} />;
    }

    let screenContent: React.ReactNode;
    switch (appState) {
        case AppState.WELCOME:
            screenContent = <WelcomeScreen user={userData.user} onStart={handleStartAssessment} />;
            break;
        case AppState.ASSESSMENT_LOADING:
            screenContent = <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Готовим для вас тест..." /></div>;
            break;
        case AppState.LEARNING:
            screenContent = (geminiService) 
                ? <LearningDashboard geminiService={geminiService} userData={userData} onTaskComplete={handleTaskComplete} onStartLevelUpTest={handleStartLevelUpTest} onFeedbackSubmit={handleFeedbackSubmit} onGlobalInstructionsChange={handleGlobalInstructionsChange}/> 
                : <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Загрузка учебной панели..." /></div>;
            break;
        case AppState.LEVEL_UP_ASSESSMENT_LOADING:
            screenContent = <div className="flex items-center justify-center min-h-[70vh]"><Loader text="Готовим тест на повышение уровня..." /></div>;
            break;
        default:
            console.error("Unknown application state:", appState);
            screenContent = <div className="text-center p-8"><p className="text-red-400">Произошла непредвиденная ошибка состояния. Пожалуйста, сбросьте сессию, нажав 'Выйти'.</p></div>;
            break;
    }
    
    return (
        <ErrorBoundary>
            <div className="bg-slate-900 min-h-screen">
                <Header user={userData.user} onReset={handleReset} level={userData.level} dailyStats={userData.dailyStats}/>
                <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                    {screenContent}
                    {generalError && <div className="fixed bottom-5 right-5"><Card className="bg-red-500/20 border-red-500 text-red-300">{generalError}</Card></div>}
                </main>
            </div>
        </ErrorBoundary>
    );
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