export enum CEFRLevel {
    A1 = "A1 (Beginner)",
    A2 = "A2 (Elementary)",
    B1 = "B1 (Intermediate)",
    B2 = "B2 (Upper-Intermediate)",
    C1 = "C1 (Advanced)",
}

export enum AppState {
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

export interface AssessmentQuestion {
    question: string;
    options: string[];
    correctAnswer: string;
    level: CEFRLevel;
}

export type TaskType = 'reading' | 'vocabulary' | 'grammar' | 'image' | 'dialogue' | 'story' | 'editing';

export interface LearningTask {
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

export interface TaskEvaluation {
    isCorrect: boolean;
    feedback: string;
}


export interface User {
    name: string;
    imageUrl: string;
}

export interface UserData {
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