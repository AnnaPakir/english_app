
import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// Add this to fix TypeScript errors for window.google
declare global {
    interface Window {
        google: any;
    }
}

// ==========================================================================================
// Bсе типы, константы, компоненты и сервисы объединены в этом файле,
// чтобы Babel мог обработать все приложение целиком. Локальные импорты и экспорты удалены.
// ==========================================================================================

// --- Configuration ---
const GOOGLE_CLIENT_ID = 'ВАШ_GOOGLE_CLIENT_ID'; // <-- ЗАМЕНИТЕ ЭТО НА СВОЙ ID
const GOOGLE_DRIVE_FILENAME = 'gemini_english_tutor_data.json';


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
    API_KEY_SETUP,
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
type TaskType = 'reading' | 'grammar' | 'vocabulary' | 'fill-in-the-blanks' | 'sentence-construction' | 'error-correction' | 'role-play' | 'word-formation' | 'translation-choice' | 'spelling-choice' | 'synonym-antonym-quiz' | 'definition-matching' | 'odd-one-out' | 'categorization';

interface LearningTask {
    type: TaskType;
    title: string;
    level: CEFRLevel;
    content: string; // Usage depends on type: reading text, incorrect sentence, dialogue starter, etc.
    questions?: {
        question: string;
        options: string[];
        correctAnswer: string;
        wordToLearn?: string; // For vocabulary/translation/spelling to track progress
    }[];
    context?: string; // For role-play, error-correction
    constraints?: string; // For role-play, sentence-construction, word-formation
    words?: string[]; // For sentence-construction
    baseWord?: string; // For word-formation
    wordToLearn?: string; // For word-formation
}

interface TaskEvaluation {
    isCorrect: boolean;
    feedback: string;
}

interface User {
    name: string;
    imageUrl: string;
}

interface MistakeInfo {
    topic: string;
    details: string;
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
    globalInstructions: string[];
    vocabularyProgress: Record<string, number>;
    recentMistakes: MistakeInfo[];
    recentTaskTypes?: TaskType[];
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
const VOCABULARY_MASTERY_THRESHOLD = 7;
const MISTAKES_TO_REMEMBER = 5;

// --- Icon Components ---
const CheckCircleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-green-400">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
    </svg>
);

const XCircleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-red-400">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
    </svg>
);

const SpeakerWaveIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 1.598.378 3.11.992 4.495 1.036 3.163 4.257 4.255 6.875 2.48l.523-.349.523.349a11.232 11.232 0 0 0 8.351 1.09c.421-.129.73-.503.73-.949V5.12c0-.446-.309-.82-.73-.949a11.23 11.23 0 0 0-8.351-1.09l-.523.349-.523-.349Z" />
    </svg>
);


// --- TTS Service ---
let voices: SpeechSynthesisVoice[] = [];
const populateVoices = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        voices = window.speechSynthesis.getVoices();
    }
};

populateVoices();
if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = populateVoices;
}

const speakText = (text: string) => {
    if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    const preferredVoiceNames = [
        "Google US English",
        "Samantha", // Apple
        "Microsoft Zira Desktop - English (United States)", // Windows
    ];
    let selectedVoice = voices.find(v => preferredVoiceNames.includes(v.name) && v.lang.startsWith('en'));
    
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.startsWith('en-US') && v.name.toLowerCase().includes('female'));
    }
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.startsWith('en-US'));
    }
    
    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }

    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1.1;

    window.speechSynthesis.speak(utterance);
};


interface SpeakButtonProps {
    text: string;
    className?: string;
}

const SpeakButton: React.FC<SpeakButtonProps> = ({ text, className = '' }) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return null;

    const handleSpeak = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        speakText(text);
    };

    return (
        <button
            onClick={handleSpeak}
            className={`text-slate-400 hover:text-purple-400 transition-colors shrink-0 ${className}`}
            aria-label={`Произнести текст`}
            title="Произнести текст"
        >
            <SpeakerWaveIcon />
        </button>
    );
};

// --- From components/common/Card.tsx ---
interface CardProps {
    children: React.ReactNode;
    className?: string;
}
const Card: React.FC<CardProps> = ({ children, className = '' }) => {
    return (
        <div className={`bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/40 p-6 sm:p-8 ${className}`}>
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
    const baseClasses = "font-bold py-2 px-4 rounded-lg focus:outline-none focus:ring-4 focus:ring-opacity-50 transition-all duration-300 ease-in-out inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed text-base transform hover:scale-[1.03] disabled:hover:scale-100";
    const variantClasses = {
        primary: "bg-purple-600 hover:bg-purple-700 focus:ring-purple-400 text-white shadow-lg shadow-purple-600/20",
        secondary: "bg-slate-600 hover:bg-slate-700 focus:ring-slate-500 text-white",
        ghost: "bg-transparent hover:bg-slate-700/50 focus:ring-slate-500 text-slate-300",
        google: "bg-white hover:bg-slate-200 focus:ring-blue-500 text-slate-800 border border-slate-300",
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
            <svg className="animate-spin h-12 w-12 text-purple-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
                model: "gemini-2.5-flash",
                contents: "test",
                config: { thinkingConfig: { thinkingBudget: 0 } }
            });
            // Changed to check response directly as .text might be empty on a simple test.
            return { success: !!response };
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
            const response: GenerateContentResponse = await this.ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt, config: { responseMimeType: "application/json", temperature: 0.3 } });
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
        For each question, provide a clear question, 4 multiple-choice options, the correct answer, and the 'level' field for all questions MUST be exactly "${level}".
        Return the result as a JSON array of objects. Each object must have this exact structure:
        { "question": "string", "options": ["string", "string", "string", "string"], "correctAnswer": "string", "level": "${level}" }
        IMPORTANT: Your entire response must be ONLY the valid JSON array.`;
        try {
             const response: GenerateContentResponse = await this.ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt, config: { responseMimeType: "application/json", temperature: 0.2 } });
            const questions = this.parseJsonResponse<AssessmentQuestion[]>(response.text);
            if (!questions || !Array.isArray(questions) || questions.length < LEVEL_UP_TEST_QUESTIONS) throw new Error("Could not generate a valid level-up test.");
            return questions.slice(0, LEVEL_UP_TEST_QUESTIONS);
        } catch (error) {
            console.error(`Error generating level-up test for ${level}:`, error);
            throw new Error("Не удалось сгенерировать тест. AI вернул некорректные данные. Попробуйте еще раз.");
        }
    }

    async generateLearningTask(level: CEFRLevel, feedbackHistory: string[], isPreLevelUp: boolean, globalInstructions: string[], vocabularyProgress: Record<string, number>, recentMistakes: MistakeInfo[], recentTaskTypes: TaskType[] = []): Promise<LearningTask | null> {
        const learnedWords = Object.entries(vocabularyProgress)
            .filter(([, count]) => count >= VOCABULARY_MASTERY_THRESHOLD)
            .map(([word]) => word);

        let varietyPrompt = '';
        if (recentTaskTypes && recentTaskTypes.length >= 2 && recentTaskTypes[0] === recentTaskTypes[1]) {
            varietyPrompt = `
IMPORTANT VARIETY RULE: The user has just completed two '${recentTaskTypes[0]}' tasks in a row.
To ensure variety, YOU MUST NOT generate another '${recentTaskTypes[0]}' task for this request. Please choose a different task type.`;
        }
    
        const mistakesPrompt = recentMistakes.length > 0
            ? `
PRIORITY REINFORCEMENT: The user has recently struggled with the following. Try to create a task that addresses one of these areas, but you must respect the variety rule if it applies.
${recentMistakes.map(m => `- Topic/Word: ${m.topic}, Details: ${m.details}`).join('\n')}`
            : '';
    
        const learnedWordsPrompt = learnedWords.length > 0
            ? `
AVOID THESE WORDS: The user has already mastered the following words. Do not use them as the primary focus for any new vocabulary, translation, or spelling tasks:
${learnedWords.join(', ')}`
            : '';
            
        const globalInstructionsPrompt = globalInstructions.length > 0
            ? `
PERMANENT USER PREFERENCES: You MUST follow them for ALL tasks you generate.
${globalInstructions.map(instr => `- ${instr}`).join('\n')}`
            : '';
    
        const feedbackPrompt = feedbackHistory.length > 0
            ? `
ONE-TIME REQUEST/FEEDBACK: Try to incorporate this into the current task.
- Here is the user's feedback/request history (most recent first):
${feedbackHistory.slice(-5).reverse().map(f => `- "${f}"`).join('\n')}` : '';

        const difficultyPrompt = isPreLevelUp
            ? `CRITICAL INSTRUCTION: The user is preparing for a level-up test. The task MUST be more challenging than a typical ${level} task.`
            : '';

        const prompt = `
You are an expert AI English tutor. Your goal is to create a single, engaging, and methodologically sound English learning task for a user at the ${level} CEFR level. The variety of tasks is very important, especially for vocabulary building.

${varietyPrompt}
${mistakesPrompt}
${globalInstructionsPrompt}
${difficultyPrompt}
${feedbackPrompt}
${learnedWordsPrompt}

Choose ONE of the following task types: 'fill-in-the-blanks', 'sentence-construction', 'error-correction', 'role-play', 'vocabulary', 'reading', 'grammar', 'word-formation', 'translation-choice', 'spelling-choice', 'synonym-antonym-quiz', 'definition-matching', 'odd-one-out', 'categorization'.
Return the result as a single, perfectly-formed JSON object. Your entire response MUST be ONLY the JSON object, without any surrounding text or markdown fences. The JSON object MUST include a "level": "${level}" field.

Here are the required structures for each type. Follow them strictly.

1.  **Quiz-based Tasks:**
    - **Applies to:** 'fill-in-the-blanks', 'reading', 'grammar', 'vocabulary', 'translation-choice', 'spelling-choice', 'synonym-antonym-quiz', 'definition-matching', 'odd-one-out', 'categorization'.
    - **Base Structure:** { "type": "string", "title": "string", "level": "${level}", "content": "string", "questions": [{ "question": "string", "options": ["string", "string", "string"], "correctAnswer": "string", "wordToLearn": "The specific word being tested, if applicable." }] }
    - **Specific Notes for Quiz types:**
        - **'wordToLearn'**: This field is MANDATORY for 'vocabulary', 'translation-choice', 'spelling-choice', 'synonym-antonym-quiz', 'definition-matching', 'odd-one-out', 'categorization' to track vocabulary progress.
        - **'vocabulary'**: The 'content' should use '___' for the gap.
        - **'translation-choice'**: The 'content' should highlight the word to be translated.
        - **'spelling-choice'**: The question asks to choose the correct spelling.
        - **'synonym-antonym-quiz'**: The question asks for a synonym or an antonym for a given word.
        - **'definition-matching'**: The question asks to match a word with its definition.
        - **'odd-one-out'**: The 'content' describes the task. The 'question' presents the group of words. Options should be the words from the group.
        - **'categorization'**: The 'question' asks to which category a given word belongs.

2.  **'word-formation' (Interactive Vocabulary Practice):**
    - Structure: { "type": "word-formation", "title": "Change the Word Form", "level": "${level}", "content": "A sentence with a word in brackets that needs to be changed. e.g., 'She has a [beauty] voice.'", "baseWord": "The word in brackets, e.g., 'beauty'", "constraints": "The target form of the word, e.g., 'Change the word to an adjective.'", "wordToLearn": "The base word, e.g., 'beauty'" }

3.  **'role-play', 'error-correction', 'sentence-construction':**
    - Use structures as previously defined: role-play requires context/content/constraints, error-correction requires content, sentence-construction requires content/words/constraints.

IMPORTANT: Ensure the generated JSON is valid. Do not add trailing commas. Respond ONLY with the JSON object. Greatly increase task variety, focusing on the new vocabulary tasks.`;
        try {
            const response: GenerateContentResponse = await this.ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt, config: { responseMimeType: "application/json", temperature: 1.0 } });
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
            case 'word-formation':
                taskContextPrompt = `
- Sentence with word to change: "${task.content}"
- Base word: "${task.baseWord}"
- Instruction: "${task.constraints}"
- Evaluation criteria: Did the user provide the correct form of the word? The correct answer should be a single word. Check if the user's answer fits grammatically and contextually.`;
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
            const response = await this.ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt, config: { responseMimeType: "application/json", temperature: 0.3 } });
            const evaluation = this.parseJsonResponse<TaskEvaluation>(response.text);
            if (!evaluation || typeof evaluation.isCorrect !== 'boolean' || !evaluation.feedback) throw new Error("Invalid evaluation format from AI.");
            return evaluation;
        } catch (error) {
            console.error("Error evaluating text task:", error);
            return { isCorrect: false, feedback: "Не удалось оценить ваш ответ. Пожалуйста, попробуйте еще раз." };
        }
    }

    async getExplanation(question: string, correctAnswer: string, userAnswer: string): Promise<string> {
        const prompt = `An English learner at a pre-intermediate level was asked a multiple-choice question: "${question}". The correct answer is "${correctAnswer}". The user incorrectly chose "${userAnswer}". Provide a very simple, one-sentence explanation in Russian about why the user's answer is wrong and the correct answer is right. Be concise and encouraging.`;
        try {
            const response = await this.ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt, config: {temperature: 0.1}});
            return response.text;
        } catch (error) {
            console.error("Error getting explanation:", error);
            return "Не удалось получить объяснение.";
        }
    }

    async getHelpFromGemini(query: string, level: CEFRLevel): Promise<string> {
        const prompt = `You are a friendly and supportive AI English tutor. A user at the ${level} level has a question or a request for their next lesson.
        User's request: "${query}"
        Provide a helpful and concise answer in simple Russian. You can explain a grammar rule, define a word, or confirm that their next task will be about their request. The answer should be encouraging.`;
        try {
            const response = await this.ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt, config: { temperature: 0.7 } });
            return response.text;
        } catch (error) {
            console.error("Error getting help from Gemini:", error);
            return "К сожалению, не удалось получить ответ от Gemini. Попробуйте еще раз.";
        }
    }
}

// --- Google Drive Service ---
class GoogleDriveService {
    private accessToken: string;
    private fileId: string | null = null;

    constructor(token: string) {
        this.accessToken = token;
    }

    private async getFileId(): Promise<string | null> {
        const response = await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)", {
            headers: { 'Authorization': `Bearer ${this.accessToken}` }
        });
        if (!response.ok) {
            console.error("Could not list files in appDataFolder", await response.json());
            throw new Error("Failed to access Google Drive.");
        }
        const data = await response.json();
        const existingFile = data.files.find((file: any) => file.name === GOOGLE_DRIVE_FILENAME);
        return existingFile ? existingFile.id : null;
    }

    async loadData(): Promise<UserData | null> {
        try {
            this.fileId = await this.getFileId();
            if (!this.fileId) return null;

            const response = await fetch(`https://www.googleapis.com/drive/v3/files/${this.fileId}?alt=media`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            if (response.ok) {
                const data = await response.json();
                return data as UserData;
            }
            if (response.status === 404) return null;
            throw new Error(`Failed to download data: ${response.statusText}`);
        } catch (error) {
            console.error("Error loading data from Google Drive:", error);
            return null;
        }
    }

    async saveData(userData: UserData): Promise<void> {
        const metadata = {
            name: GOOGLE_DRIVE_FILENAME,
            mimeType: 'application/json',
            ...(this.fileId ? {} : { parents: ['appDataFolder'] })
        };
        const fileContent = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' });
        
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', fileContent);
        
        const url = this.fileId 
            ? `https://www.googleapis.com/upload/drive/v3/files/${this.fileId}?uploadType=multipart`
            : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        
        const method = this.fileId ? 'PATCH' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Authorization': `Bearer ${this.accessToken}` },
            body: form
        });
        if (!response.ok) {
             console.error("Failed to save data to Google Drive", await response.json());
             throw new Error("Could not save progress to Google Drive.");
        }
        if (!this.fileId) {
            const newFile = await response.json();
            this.fileId = newFile.id;
        }
    }
}


// --- From components/AuthScreen.tsx ---
const GoogleAuthScreen: React.FC = () => {
    const authButtonRef = useRef(null);

    useEffect(() => {
        if (authButtonRef.current && window.google) {
            window.google.accounts.id.renderButton(
                authButtonRef.current,
                { theme: "outline", size: "large", text: "signin_with", shape: "rectangular" }
            );
        }
    }, []);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
            <Card className="max-w-md w-full text-center animate-fade-in-up">
                <h1 className="text-3xl font-bold text-slate-100 mb-2">Gemini English Tutor</h1>
                <p className="text-slate-400 mb-8">Войдите с помощью Google, чтобы начать обучение и сохранять свой прогресс.</p>
                <div ref={authButtonRef} className="flex justify-center"></div>
                <p className="text-xs text-slate-500 mt-8">Ваш прогресс и API ключ Gemini будут сохранены в специальной папке вашего Google Drive, доступной только этому приложению.</p>
            </Card>
        </div>
    );
};


// --- ApiKeySetupScreen Component ---
interface ApiKeySetupScreenProps { onApiKeySubmit: (apiKey: string) => void; isLoading: boolean; }
const ApiKeySetupScreen: React.FC<ApiKeySetupScreenProps> = ({ onApiKeySubmit, isLoading }) => {
    const [apiKey, setApiKey] = useState('');
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (apiKey.trim()) onApiKeySubmit(apiKey.trim());
    };
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
            <Card className="max-w-md w-full text-center animate-fade-in-up">
                <h1 className="text-3xl font-bold text-slate-100 mb-2">Последний шаг!</h1>
                <p className="text-slate-400 mb-8">Пожалуйста, введите ваш API ключ от Google AI Studio. Он будет безопасно сохранен в вашем Google Drive.</p>
                <form onSubmit={handleSubmit} className='space-y-4'>
                    <input
                        id="api-key-input"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Введите ваш Google AI API ключ"
                        required
                        className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                    <Button type="submit" variant="primary" className="w-full text-lg py-3" disabled={!apiKey.trim() || isLoading} isLoading={isLoading}>
                        {isLoading ? 'Проверка...' : 'Сохранить и начать'}
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
        <div className="max-w-4xl mx-auto flex justify-between items-center border-b border-slate-700/50 pb-4">
            <div className="flex items-center gap-3">
                <img src={user.imageUrl} alt={user.name} className="w-10 h-10 rounded-full border-2 border-slate-600" />
                <div className="flex items-center gap-x-3 flex-wrap">
                    <h1 className="font-bold text-slate-100">{user.name}</h1>
                    {level && <span className="bg-purple-600/50 text-purple-300 text-xs font-medium px-2.5 py-0.5 rounded-full border border-purple-500">{level}</span>}
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
            <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-500 to-purple-600 mb-4">Добро пожаловать, {user.name}!</h1>
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
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
            <Card className="w-full max-w-2xl">
                <div className="mb-4">
                    <div className="flex justify-between mb-1"><span className="text-base font-medium text-purple-400">Прогресс</span><span className="text-sm font-medium text-purple-400">{currentQuestionIndex + 1} / {questions.length}</span></div>
                    <div className="w-full bg-slate-700 rounded-full h-2.5"><div className="bg-purple-600 h-2.5 rounded-full" style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}></div></div>
                </div>
                <h2 className="text-2xl font-bold text-slate-100 mb-2">{`Вопрос ${currentQuestionIndex + 1}`}</h2>
                <div className="flex items-start gap-2 text-slate-300 text-lg mb-6">
                    <p className="flex-grow">{currentQuestion.question}</p>
                    <SpeakButton text={currentQuestion.question} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">{currentQuestion.options.map((option, index) => <button key={index} onClick={() => handleAnswerSelect(option)} disabled={isAnswered} className={`w-full p-4 rounded-lg text-left transition-colors duration-300 flex justify-between items-center ${getButtonClass(option)}`}>
                    <span>{option}</span>
                    <SpeakButton text={option} />
                </button>)}</div>
                {isAnswered && <div className="text-right"><Button onClick={handleNext}>{currentQuestionIndex < questions.length - 1 ? 'Следующий вопрос' : 'Завершить'}</Button></div>}
            </Card>
        </div>
    );
};

// --- From components/ResultsScreen.tsx ---
interface ResultsScreenProps { level: CEFRLevel; onStartLearning: () => void; }
const ResultsScreen: React.FC<ResultsScreenProps> = ({ level, onStartLearning }) => (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
        <Card className="max-w-xl text-center animate-fade-in-up">
            <h2 className="text-3xl font-bold text-slate-100 mb-2">Тест завершен!</h2>
            <p className="text-slate-300 text-lg mb-4">Ваш предполагаемый уровень владения английским:</p>
            <div className="bg-purple-600 text-white text-4xl font-bold rounded-lg py-4 px-8 inline-block mb-8">{level}</div>
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
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl shadow-lg p-4">
            <div className="flex justify-between items-center mb-2"><h3 className="font-bold text-slate-200">Прогресс к следующему уровню</h3><span className="text-lg font-mono font-bold text-purple-300">{correctCount} / {PROGRESS_UNLOCK_THRESHOLD}</span></div>
            <p className="text-sm text-slate-400 mb-3">Правильно ответьте на {PROGRESS_UNLOCK_THRESHOLD} из последних {PROGRESS_HISTORY_LENGTH} заданий, чтобы разблокировать тест на повышение уровня.</p>
            <div className="w-full bg-slate-700 rounded-full h-4 relative overflow-hidden"><div className="bg-gradient-to-r from-fuchsia-600 to-purple-600 h-4 rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercentage}%` }}></div></div>
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
        }, 800);
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
        return <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900"><Loader text="Подсчет результатов..." /></div>;
    }
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) {
       return <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900"><Loader text="Загрузка вопроса..." /></div>;
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
            <Card className="w-full max-w-2xl">
                <div className="mb-6"><h2 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-500 to-purple-600 mb-2">Тест на повышение уровня</h2><p className="text-center text-slate-400">Для прохождения нужно ответить правильно на {LEVEL_UP_PASS_PERCENTAGE * 100}% вопросов.</p></div>
                <div className="mb-4">
                    <div className="flex justify-between mb-1"><span className="text-base font-medium text-purple-400">Прогресс</span><span className="text-sm font-medium text-purple-400">{currentQuestionIndex + 1} / {questions.length}</span></div>
                    <div className="w-full bg-slate-700 rounded-full h-2.5"><div className="bg-purple-600 h-2.5 rounded-full transition-width duration-300" style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}></div></div>
                </div>
                <h3 className="text-2xl font-bold text-slate-100 mb-2">{`Вопрос ${currentQuestionIndex + 1}`}</h3>
                <div className="flex items-start gap-2 text-slate-300 text-lg mb-6">
                    <p className="flex-grow">{currentQuestion.question}</p>
                    <SpeakButton text={currentQuestion.question}/>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {currentQuestion.options.map((option, index) => (
                        <button key={index} onClick={() => handleAnswerSelect(option)} disabled={!!selectedAnswer} className={`w-full p-4 rounded-lg text-left transition-colors duration-300 flex justify-between items-center ${getButtonClassForLevelUp(option)}`}>
                            <span>{option}</span>
                            <SpeakButton text={option} />
                        </button>
                    ))}
                </div>
            </Card>
        </div>
    );
};


// --- From components/LevelUpResultsScreen.tsx ---
interface LevelUpResultsScreenProps { isSuccess: boolean; newLevel: CEFRLevel | null; onContinue: () => void; }
const LevelUpResultsScreen: React.FC<LevelUpResultsScreenProps> = ({ isSuccess, newLevel, onContinue }) => (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
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
interface LearningDashboardProps { geminiService: GeminiService; userData: UserData; onTaskComplete: (payload: {results: {isCorrect: boolean, wordToLearn?: string}[], task: LearningTask}) => void; onStartLevelUpTest: () => void; onFeedbackSubmit: (feedback: string) => void; onGlobalInstructionsChange: (instructions: string[]) => void;}
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
    const [showFeedbackForm, setShowFeedbackForm] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");
    const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
    
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    const [helpQuery, setHelpQuery] = useState("");
    const [isHelpLoading, setIsHelpLoading] = useState(false);
    const [helpResponse, setHelpResponse] = useState<string | null>(null);
    
    const [isPreferencesModalOpen, setIsPreferencesModalOpen] = useState(false);
    const [newInstruction, setNewInstruction] = useState("");
    
    const [isLearnedWordsModalOpen, setIsLearnedWordsModalOpen] = useState(false);


    const INTERACTIVE_TASK_TYPES: TaskType[] = ['sentence-construction', 'error-correction', 'role-play', 'word-formation'];

    const correctCount = userData.taskHistory.filter(Boolean).length;
    const canAttemptLevelUp = correctCount >= PROGRESS_UNLOCK_THRESHOLD;
    const preLevelUpThreshold = 50;
    const isPreLevelUp = !canAttemptLevelUp && correctCount >= preLevelUpThreshold;

    const fetchTask = useCallback(async (isRetry: boolean = false) => {
        if (!isRetry) {
            setTask(null); setSelectedAnswers({}); setShowResults(false); setTaskResults([]); setExplanations({}); setIsChecking(false); setUserInput(""); setEvaluation(null); setShowFeedbackForm(false); setFeedbackText(""); setFeedbackSubmitted(false);
            setIsLoading(true); setError(null);
        } else { setError(null); setIsLoading(true); }
        try {
            const newTask = await geminiService.generateLearningTask(userData.level!, userData.feedbackHistory, isPreLevelUp, userData.globalInstructions, userData.vocabularyProgress, userData.recentMistakes, userData.recentTaskTypes || []);
            if (!newTask) throw new Error("Received empty task from API.");
            setTask(newTask);
        } catch (err: any) { setError(err.message || 'An unknown error occurred.'); } 
        finally { setIsLoading(false); }
    }, [userData.level, userData.feedbackHistory, userData.globalInstructions, userData.vocabularyProgress, userData.recentMistakes, geminiService, isPreLevelUp, userData.recentTaskTypes]);
    
    useEffect(() => {
        fetchTask();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleCheckAnswers = async () => {
        if (!task) return;
        setIsChecking(true);
        if (task.type && INTERACTIVE_TASK_TYPES.includes(task.type)) {
            const result = await geminiService.evaluateTextTask(task, userInput);
            setEvaluation(result);
            onTaskComplete({results: [{ isCorrect: result.isCorrect, wordToLearn: task.wordToLearn }], task});
        } else if (task.questions) {
            const newExplanations: Record<number, string> = {};
            const explanationPromises: Promise<void>[] = task.questions.map((q, index) => {
                const userAnswer = selectedAnswers[index];
                if (userAnswer && userAnswer !== q.correctAnswer) return geminiService.getExplanation(q.question, q.correctAnswer, userAnswer).then(exp => { newExplanations[index] = exp; });
                return Promise.resolve();
            });
            await Promise.all(explanationPromises);
            setExplanations(newExplanations);
            const resultsPayload = task.questions.map((q, i) => ({
                isCorrect: selectedAnswers[i] === q.correctAnswer,
                wordToLearn: q.wordToLearn
            }));
            setTaskResults(resultsPayload.map(r => r.isCorrect));
            onTaskComplete({results: resultsPayload, task});
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

    const { learningWords, learnedWords } = Object.entries(userData.vocabularyProgress)
        .reduce((acc, [word, count]) => {
            if (count >= VOCABULARY_MASTERY_THRESHOLD) {
                acc.learnedWords.push(word);
            } else if (count > 0) {
                acc.learningWords.push({ word, count });
            }
            return acc;
        }, { learningWords: [] as {word: string, count: number}[], learnedWords: [] as string[] });
    
    learningWords.sort((a, b) => b.count - a.count);
    learnedWords.sort();


    const renderQuizTask = () => {
        if (!task || !task.questions) return null;

        return (
            <>
                <div className="flex items-start gap-2 text-slate-300 text-lg mb-6 whitespace-pre-wrap">
                    <p className="flex-grow">{task.content}</p>
                    <SpeakButton text={task.content.replace(/___/g, 'blank')} />
                </div>
                <div className="space-y-6">
                    {task.questions.map((q, qIndex) => (
                        <div key={qIndex}>
                             <div className="flex items-start gap-2 font-semibold text-slate-200 mb-3">
                                <h3 className="flex-grow">{q.question}</h3>
                                <SpeakButton text={q.question} />
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                                {q.options.map((option, oIndex) => {
                                    const isSelected = selectedAnswers[qIndex] === option;
                                    const isCorrect = task.questions?.[qIndex]?.correctAnswer === option;
                                    
                                    let buttonClass = 'bg-slate-700 hover:bg-slate-600';
                                    let icon = null;

                                    if (showResults) {
                                        if (isCorrect) {
                                            buttonClass = 'bg-green-800/50 border border-green-600 text-slate-100 cursor-default';
                                            icon = <CheckCircleIcon/>;
                                        } else if (isSelected) {
                                            buttonClass = 'bg-red-800/50 border border-red-600 text-slate-100 cursor-default';
                                            icon = <XCircleIcon/>;
                                        } else {
                                            buttonClass = 'bg-slate-800/60 opacity-60 cursor-not-allowed';
                                        }
                                    } else if (isSelected) {
                                        buttonClass = 'bg-purple-600 ring-2 ring-offset-2 ring-offset-slate-800 ring-purple-500';
                                    }

                                    return (
                                        <button 
                                            key={oIndex} 
                                            onClick={() => !showResults && setSelectedAnswers(prev => ({ ...prev, [qIndex]: option }))} 
                                            disabled={showResults} 
                                            className={`p-3 rounded-lg text-left transition-all duration-300 flex justify-between items-center ${buttonClass}`}
                                        >
                                            <span className="flex-1 pr-4">{option}</span>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <SpeakButton text={option}/>
                                                {icon}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                            {showResults && explanations[qIndex] && (
                                <div className="mt-3 p-3 bg-red-900/50 border border-red-700/50 rounded-lg">
                                    <h4 className="font-semibold text-red-200 mb-1">Разбор ошибки:</h4>
                                    <p className="text-red-300">{explanations[qIndex]}</p>
                                </div>
                            )}
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
                             <div className="flex justify-between items-start gap-2"><p><strong>Сценарий:</strong> {task.context}</p><SpeakButton text={task.context || ''}/></div>
                             <div className="flex justify-between items-start gap-2"><p><strong>Ваша задача:</strong> {task.constraints}</p><SpeakButton text={task.constraints || ''}/></div>
                        </div>
                    );
                case 'error-correction':
                     return (
                        <div className="text-slate-400 mb-2 space-y-1">
                            <p><strong>Задание:</strong> Найдите и исправьте ошибку в предложении ниже.</p>
                            {task.context && <div className="flex justify-between items-start gap-2"><p><strong>Контекст:</strong> {task.context}</p><SpeakButton text={task.context}/></div>}
                        </div>
                    );
                case 'sentence-construction':
                    return (
                        <div className="text-slate-400 mb-4 space-y-2">
                             <div className="flex justify-between items-start gap-2"><p><strong>Задание:</strong> {task.content}</p><SpeakButton text={task.content}/></div>
                            <p className="font-medium text-slate-300">Используйте эти слова:</p>
                            <div className="flex flex-wrap gap-2">{task.words?.map((word, i) => <div key={i} className="flex items-center gap-2 font-mono text-purple-300 bg-slate-700/50 px-2 py-1 rounded-md border border-slate-600"><span>{word}</span><SpeakButton text={word}/></div>)}</div>
                            {task.constraints && <div className="flex justify-between items-start gap-2"><p><strong>Условие:</strong> {task.constraints}</p><SpeakButton text={task.constraints}/></div>}
                        </div>
                    );
                case 'word-formation':
                    return (
                        <div className="text-slate-400 mb-4 space-y-2">
                             <div className="flex justify-between items-start gap-2"><p><strong>Задание:</strong> {task.constraints}</p><SpeakButton text={task.constraints || ''}/></div>
                             <div className="flex justify-between items-start gap-2"><p><strong>Предложение:</strong> <span className="italic">{task.content}</span></p><SpeakButton text={task.content || ''}/></div>
                        </div>
                    );
                default: return null;
            }
        }

        return (
            <div>
                <div className="mb-4">{getContextDescription()}</div>
                {task.type === 'role-play' && (<div className="mb-4 p-3 border-l-4 border-purple-500 bg-slate-900/50">
                    <p className="font-semibold">Собеседник:</p>
                    <div className="flex items-center gap-2">
                        <p className="text-slate-300 italic flex-grow">"{task.content}"</p>
                        <SpeakButton text={task.content} />
                    </div>
                </div>)}
                {task.type === 'error-correction' && (
                    <div className="mb-4">
                        <p className="text-sm font-semibold text-slate-500">ПРЕДЛОЖЕНИЕ С ОШИБКОЙ</p>
                        <div className="text-slate-300 p-3 bg-slate-900/50 rounded-md mt-1 italic flex justify-between items-center">
                            <span>{task.content}</span>
                            <SpeakButton text={task.content}/>
                        </div>
                    </div>
                )}
                <label htmlFor="user-input" className="block text-sm font-medium text-slate-300 mb-2">Ваш ответ:</label>
                <textarea id="user-input" value={userInput} onChange={(e) => setUserInput(e.target.value)} disabled={showResults} rows={4} className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:outline-none disabled:opacity-70" placeholder="Напишите здесь..."/>
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
                    <textarea id="feedback-input" value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} rows={3} className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:outline-none" placeholder="Например: 'Это было слишком легко' или 'Больше заданий на грамматику!'"/>
                    <div className="flex justify-end gap-2 mt-2">
                         <Button type="button" variant="ghost" onClick={() => setShowFeedbackForm(false)}>Отмена</Button>
                         <Button type="submit" variant="secondary" disabled={!feedbackText.trim()}>Отправить отзыв</Button>
                    </div>
                </form>
            );
        }
        return (
            <div className="mt-6 border-t border-slate-700/50 pt-6 flex justify-center">
                <Button variant="ghost" onClick={() => setShowFeedbackForm(true)}>Оставить отзыв о задании</Button>
            </div>
        )
    };
    
    return (
        <div className="py-8">
            <header className="mb-8">
                <ProgressTracker history={userData.taskHistory} isPreLevelUp={isPreLevelUp} />
                {(canAttemptLevelUp) && (
                     <Card className="mt-4 text-center bg-purple-900/50 border-purple-700">
                        <h3 className="text-xl font-bold text-white">Поздравляем!</h3>
                        <p className="text-purple-200 mt-2 mb-4">Вы готовы проверить свои знания и перейти на следующий уровень?</p>
                        <Button onClick={onStartLevelUpTest} variant="primary">Пройти тест на повышение</Button>
                     </Card>
                )}
            </header>
            
            {!canAttemptLevelUp && (
                <div className="mb-6">
                    <Card className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 sm:p-6">
                        <div>
                            <h3 className="font-bold text-slate-200">Настройте свое обучение</h3>
                            <p className="text-sm text-slate-400 mt-1">Задайте тему, установите предпочтения или посмотрите выученные слова.</p>
                        </div>
                        <div className='flex gap-2 flex-col sm:flex-row flex-wrap justify-center'>
                            <Button onClick={() => setIsHelpModalOpen(true)} variant="secondary" className="flex-shrink-0">Спросить Gemini</Button>
                            <Button onClick={() => setIsPreferencesModalOpen(true)} variant="ghost" className="flex-shrink-0">Мои предпочтения</Button>
                            <Button onClick={() => setIsLearnedWordsModalOpen(true)} variant="ghost" className="flex-shrink-0">Мои слова</Button>
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
                            <div className="flex items-center gap-2 flex-1 pr-2">
                               <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-500 to-purple-500">{task.title}</h2>
                               <SpeakButton text={task.title} />
                            </div>
                            <span className="bg-slate-700 text-purple-300 text-xs font-medium whitespace-nowrap px-2.5 py-0.5 rounded-full capitalize">{task.type.replace(/-/g, ' ')}</span>
                        </div>
                        
                        {isInteractiveTask ? renderInteractiveTask() : renderQuizTask()}

                        <div className="mt-8 flex justify-end gap-4">
                            {showResults ? 
                                <Button onClick={() => fetchTask()} isLoading={isLoading}>Новое задание</Button> : 
                                <Button 
                                    onClick={handleCheckAnswers} 
                                    isLoading={isChecking} 
                                    disabled={
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

            {isHelpModalOpen && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
                    <Card className="w-full max-w-lg relative">
                        <button onClick={handleHelpModalClose} className="absolute top-3 right-4 text-slate-500 hover:text-white transition-colors text-2xl font-bold leading-none p-1" aria-label="Закрыть">&times;</button>
                        <h3 className="text-xl font-bold text-slate-100 mb-4 pr-8">Задать вопрос Gemini</h3>
                        {!helpResponse && !isHelpLoading && (
                            <form onSubmit={handleHelpSubmit}>
                                <p className="text-slate-400 mb-4">Что бы вы хотели изучить? Ваше следующее задание будет основано на этом.</p>
                                <textarea value={helpQuery} onChange={(e) => setHelpQuery(e.target.value)} rows={4} className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:outline-none" placeholder="Например: 'Хочу попрактиковать неправильные глаголы'"/>
                                <div className="mt-4 flex justify-end"><Button type="submit" isLoading={isHelpLoading} disabled={!helpQuery.trim()}>Отправить</Button></div>
                            </form>
                        )}
                        {isHelpLoading && <Loader text="Думаем..." />}
                        {helpResponse && (
                            <div>
                                <p className="text-slate-400 mb-4">Вот ответ от Gemini:</p>
                                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 max-h-60 overflow-y-auto"><p className="text-slate-300 whitespace-pre-wrap">{helpResponse}</p></div>
                                <div className="mt-6 text-right"><Button onClick={handleHelpModalClose}>Понятно!</Button></div>
                            </div>
                        )}
                    </Card>
                </div>
            )}
            
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
                            ) : ( <p className="text-slate-500 italic text-center py-4">Вы пока не добавили предпочтений.</p> )}
                        </div>
                        <div className="border-t border-slate-700 pt-6">
                            <h4 className="font-semibold text-slate-300 mb-3">Добавить новое предпочтение</h4>
                             <textarea value={newInstruction} onChange={(e) => setNewInstruction(e.target.value)} rows={3} className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-purple-500 focus:outline-none" placeholder="Например: 'Больше заданий на разговорную речь'"/>
                            <div className="mt-4 flex justify-end gap-2">
                                <Button onClick={handleAddInstruction} disabled={!newInstruction.trim()}>Добавить</Button>
                                <Button onClick={() => setIsPreferencesModalOpen(false)} variant="secondary">Готово</Button>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {isLearnedWordsModalOpen && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
                    <Card className="w-full max-w-lg relative">
                        <button onClick={() => setIsLearnedWordsModalOpen(false)} className="absolute top-3 right-4 text-slate-500 hover:text-white transition-colors text-2xl font-bold leading-none p-1" aria-label="Закрыть">&times;</button>
                        <h3 className="text-xl font-bold text-slate-100 mb-6 pr-8">Мои слова</h3>
                        
                        {learningWords.length === 0 && learnedWords.length === 0 ? (
                             <p className="text-slate-500 italic text-center py-4">Вы пока не выучили ни одного слова. Продолжайте заниматься!</p>
                        ) : (
                        <div className="max-h-[60vh] overflow-y-auto pr-2">
                            {learningWords.length > 0 && (
                                <div className="mb-8">
                                    <h4 className="font-semibold text-slate-300 mb-3">В процессе изучения ({learningWords.length})</h4>
                                    <div className="space-y-3">
                                        {learningWords.map(({ word, count }) => (
                                            <div key={word} className="bg-slate-700/50 p-3 rounded-lg text-sm">
                                                <div className="flex justify-between items-center mb-1.5">
                                                    <span className="text-slate-200 capitalize font-medium">{word}</span>
                                                    <span className="text-purple-300 font-mono text-xs">{count}/{VOCABULARY_MASTERY_THRESHOLD}</span>
                                                </div>
                                                <div className="w-full bg-slate-600 rounded-full h-1.5">
                                                    <div className="bg-purple-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${(count / VOCABULARY_MASTERY_THRESHOLD) * 100}%` }}></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {learnedWords.length > 0 && (
                                <div>
                                    <h4 className="font-semibold text-slate-300 mb-3">Выученные слова ({learnedWords.length})</h4>
                                    <ul className="flex flex-wrap gap-2">
                                        {learnedWords.map(word => (
                                            <li key={word} className="bg-green-600/20 border border-green-500/30 text-green-300 px-2.5 py-1 rounded-full capitalize text-sm">{word}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                        )}
                        
                        <div className="mt-8 text-right">
                            <Button onClick={() => setIsLearnedWordsModalOpen(false)}>Закрыть</Button>
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
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) { console.error("Uncaught error in ErrorBoundary:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
          <Card className="max-w-2xl w-full text-center">
            <h1 className="text-3xl font-bold text-red-400 mb-4">Что-то пошло не так.</h1>
            <p className="text-slate-300 mb-6">Произошла непредвиденная ошибка в приложении. Пожалуйста, попробуйте перезагрузить страницу или сбросить сессию.</p>
            <div className="bg-slate-800 p-4 rounded-lg text-left overflow-auto max-h-60 mb-6">
                <code className="text-red-300 text-sm whitespace-pre-wrap">{this.state.error?.toString()}</code>
            </div>
            <Button onClick={() => { window.location.reload(); }}>Перезагрузить</Button>
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
    const [googleDriveService, setGoogleDriveService] = useState<GoogleDriveService | null>(null);
    const [assessmentQuestions, setAssessmentQuestions] = useState<AssessmentQuestion[]>([]);
    const [levelUpQuestions, setLevelUpQuestions] = useState<AssessmentQuestion[]>([]);
    const [levelUpResult, setLevelUpResult] = useState<{isSuccess: boolean; newLevel: CEFRLevel | null}>({isSuccess: false, newLevel: null});
    const [authError, setAuthError] = useState<string | null>(null);
    const [generalError, setGeneralError] = useState<string | null>(null);
    const [isInitializing, setIsInitializing] = useState(true);
    const [isApiKeyLoading, setIsApiKeyLoading] = useState(false);
    
    let tokenClientRef = useRef<any>(null);

    const getToday = () => new Date().toISOString().split('T')[0];

    const handleUserDataChange = useCallback(async (newUserData: UserData) => {
        setUserData(newUserData);
        try {
            await googleDriveService?.saveData(newUserData);
        } catch (e: any) {
            console.error("Failed to save data to drive", e);
            setGeneralError("Не удалось сохранить прогресс. Проверьте соединение.");
        }
    }, [googleDriveService]);

    const handleGoogleAuthResponse = useCallback(async (tokenResponse: any) => {
        setIsInitializing(true);
        setAuthError(null);
        
        try {
            const driveService = new GoogleDriveService(tokenResponse.access_token);
            setGoogleDriveService(driveService);

            // Fetch user profile
            const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { 'Authorization': `Bearer ${tokenResponse.access_token}` }
            });
            if (!profileResponse.ok) throw new Error('Could not fetch Google user profile.');
            const profile = await profileResponse.json();

            const savedData = await driveService.loadData();
            
            if (savedData && savedData.apiKey) {
                const service = new GeminiService(savedData.apiKey);
                const connectionTest = await service.testConnection();
                if (connectionTest.success) {
                    setGeminiService(service);
                    const today = getToday();
                    if (!savedData.dailyStats || savedData.dailyStats.date !== today) {
                        savedData.dailyStats = { date: today, completed: 0, correct: 0 };
                    }
                    // Ensure all fields are present
                    savedData.taskHistory = savedData.taskHistory || [];
                    savedData.feedbackHistory = savedData.feedbackHistory || [];
                    savedData.globalInstructions = savedData.globalInstructions || [];
                    savedData.vocabularyProgress = savedData.vocabularyProgress || {};
                    savedData.recentMistakes = savedData.recentMistakes || [];
                    savedData.recentTaskTypes = savedData.recentTaskTypes || [];
                    
                    setUserData(savedData);
                    setAppState(savedData.level ? AppState.LEARNING : AppState.WELCOME);
                } else {
                     setAuthError(connectionTest.error || "Сохраненный ключ Gemini больше не действителен.");
                     setAppState(AppState.API_KEY_SETUP); // Ask for key again
                }
            } else {
                const partialUserData = {
                    user: { name: profile.given_name || profile.name, imageUrl: profile.picture }
                };
                 setUserData(prev => ({...(prev || {} as UserData), ...partialUserData}));
                 setAppState(AppState.API_KEY_SETUP);
            }
        } catch (e: any) {
            console.error("Google Auth or data loading failed", e);
            setAuthError("Не удалось войти или загрузить данные. Попробуйте еще раз.");
            setAppState(AppState.AUTH);
        } finally {
            setIsInitializing(false);
        }
    }, []);

    useEffect(() => {
        const scriptLoadedCheck = setInterval(() => {
            if (window.google) {
                clearInterval(scriptLoadedCheck);
                
                // Initialize Google Sign-In
                window.google.accounts.id.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    callback: (response: any) => {
                       // This is for the button UI, we handle token flow separately
                       // For simplicity we will now get the access token right away
                       tokenClientRef.current.requestAccessToken();
                    }
                });
                
                // Initialize Token Client
                tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/drive.appdata',
                    callback: (tokenResponse: any) => {
                        if (tokenResponse && tokenResponse.access_token) {
                            handleGoogleAuthResponse(tokenResponse);
                        }
                    },
                     error_callback: (error: any) => {
                        console.error('Google token client error:', error);
                        setAuthError(`Ошибка входа: ${error.type || 'пожалуйста, попробуйте еще раз.'}`);
                        setIsInitializing(false);
                        setAppState(AppState.AUTH);
                    }
                });
                
                setIsInitializing(false);
            }
        }, 100);

        return () => clearInterval(scriptLoadedCheck);
    }, [handleGoogleAuthResponse]);
    
    const handleApiKeySubmit = useCallback(async (apiKey: string) => {
        if (!userData || !userData.user) {
            setAuthError("User data is missing, please sign in again.");
            setAppState(AppState.AUTH);
            return;
        }
        setIsApiKeyLoading(true);
        const service = new GeminiService(apiKey);
        const connectionTest = await service.testConnection();
        if(connectionTest.success) {
            setGeminiService(service);
            const today = getToday();
            const newUserData: UserData = {
                user: userData.user,
                apiKey,
                level: null,
                taskHistory: [],
                dailyStats: { date: today, completed: 0, correct: 0 },
                feedbackHistory: [],
                globalInstructions: [],
                vocabularyProgress: {},
                recentMistakes: [],
                recentTaskTypes: []
            };
            await handleUserDataChange(newUserData);
            setAppState(AppState.WELCOME);
        } else {
            setGeneralError(connectionTest.error || "Не удалось проверить API ключ.");
        }
        setIsApiKeyLoading(false);
    }, [userData, handleUserDataChange]);

    const handleReset = useCallback(() => {
        // We can't easily revoke the token, but we can clear the state
        // The user can manually revoke access in their Google Account settings
        setUserData(null);
        setGeminiService(null);
        setGoogleDriveService(null);
        setAssessmentQuestions([]);
        setLevelUpQuestions([]);
        setAuthError(null);
        setGeneralError(null);
        setAppState(AppState.AUTH);
        // Prompt user to re-login to clear tokens
        if(tokenClientRef.current) tokenClientRef.current.requestAccessToken();
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

    const handleTaskComplete = useCallback((payload: { results: {isCorrect: boolean, wordToLearn?: string}[], task: LearningTask }) => {
        if (!userData) return;

        const { results: taskResults, task } = payload;
        const resultsBools = taskResults.map(r => r.isCorrect);

        const newMistakes: MistakeInfo[] = [];
        taskResults.forEach((result, index) => {
            if (!result.isCorrect) {
                const mistake: MistakeInfo = { topic: task.title, details: 'General task' };
                if (task.questions && task.questions[index]) {
                    const q = task.questions[index];
                    mistake.topic = q.wordToLearn || task.type;
                    mistake.details = q.question;
                } else {
                    mistake.topic = task.wordToLearn || task.type;
                    mistake.details = task.content;
                }
                newMistakes.push(mistake);
            }
        });
        
        const updatedRecentMistakes = [...newMistakes, ...userData.recentMistakes].slice(0, MISTAKES_TO_REMEMBER);

        const newHistory = [...userData.taskHistory, ...resultsBools].slice(-PROGRESS_HISTORY_LENGTH);
        const newDailyStats = { ...userData.dailyStats, completed: userData.dailyStats.completed + resultsBools.length, correct: userData.dailyStats.correct + resultsBools.filter(Boolean).length };
        
        const newVocabProgress = { ...userData.vocabularyProgress };
        taskResults.forEach(result => {
            if (result.wordToLearn) {
                const word = result.wordToLearn.toLowerCase().trim();
                if (word && result.isCorrect) {
                     newVocabProgress[word] = (newVocabProgress[word] || 0) + 1;
                }
            }
        });

        const newRecentTaskTypes = [task.type, ...(userData.recentTaskTypes || [])].slice(0, 2);

        handleUserDataChange({ ...userData, taskHistory: newHistory, dailyStats: newDailyStats, vocabularyProgress: newVocabProgress, recentMistakes: updatedRecentMistakes, recentTaskTypes: newRecentTaskTypes });
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
        return <div className="bg-slate-900 min-h-screen flex items-center justify-center"><Loader text="Инициализация..." /></div>;
    }

    if (appState === AppState.AUTH) {
        return <GoogleAuthScreen />;
    }
    
    if (appState === AppState.API_KEY_SETUP) {
        return <ApiKeySetupScreen onApiKeySubmit={handleApiKeySubmit} isLoading={isApiKeyLoading} />;
    }
    
    if (!userData) {
         return <div className="bg-slate-900 min-h-screen flex items-center justify-center"><Loader text="Ожидание данных пользователя..." /></div>;
    }

    if (appState === AppState.ASSESSING) return <Assessment questions={assessmentQuestions} onComplete={handleAssessmentComplete} />;
    if (appState === AppState.RESULTS) return userData.level ? <ResultsScreen level={userData.level} onStartLearning={() => setAppState(AppState.LEARNING)} /> : <div className="bg-gray-950 min-h-screen flex items-center justify-center"><Loader text="Анализ результатов..." /></div>;
    if (appState === AppState.LEVEL_UP_ASSESSING) return <LevelUpAssessment questions={levelUpQuestions} onComplete={handleLevelUpTestComplete} />;
    if (appState === AppState.LEVEL_UP_RESULTS) return <LevelUpResultsScreen isSuccess={levelUpResult.isSuccess} newLevel={levelUpResult.newLevel} onContinue={() => { setAppState(AppState.LEARNING); setLevelUpQuestions([]); setLevelUpResult({isSuccess: false, newLevel: null}); }} />;

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
            <div className="bg-gradient-to-br from-slate-900 via-gray-900 to-slate-900 min-h-screen">
                <Header user={userData.user} onReset={handleReset} level={userData.level} dailyStats={userData.dailyStats}/>
                <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                    {screenContent}
                    {(generalError || authError) && <div className="fixed bottom-5 right-5"><Card className="bg-red-500/20 border-red-500 text-red-300">{generalError || authError}</Card></div>}
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