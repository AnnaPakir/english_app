
export enum CEFRLevel {
    A1 = "A1 (Beginner)",
    A2 = "A2 (Elementary)",
    B1 = "B1 (Intermediate)",
    B2 = "B2 (Upper-Intermediate)",
    C1 = "C1 (Advanced)",
}

export enum AppState {
    AUTH,
    AUTH_LOADING,
    WELCOME,
    ASSESSING,
    ASSESSMENT_LOADING,
    RESULTS,
    LEARNING,
}

export interface AssessmentQuestion {
    level: CEFRLevel;
    question: string;
    options: string[];
    correctAnswer: string;
}

export interface AssessmentAnswer {
    question: string;
    answer: string;
    correctAnswer: string;
}

export interface VocabularyWord {
    word: string;
    mastery: number;
}

export interface UserData {
    level: CEFRLevel;
    vocabulary: VocabularyWord[];
    taskHistory: string[];
    tasksCompleted: number;
    recentNewWords: string[];
}

export interface LearningTask {
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

export interface GoogleUser {
    name: string;
    email: string;
    picture: string;
}

export const ALL_TASK_TYPES = [
    'Translate', 'FillInTheBlank', 'BuildSentence', 'Listen',
    'CorrectTheMistake', 'MultipleChoice', 'WordDefinition',
    'SynonymsAndAntonyms', 'MatchDefinition', 'OddOneOut', 'Categorization'
];
