
import { GoogleGenAI, Type } from "@google/genai";
import { ALL_TASK_TYPES, CEFRLevel } from '../types';
import { ASSESSMENT_QUESTIONS, CONCURRENT_WORDS_TO_LEARN } from "../constants";

// Utility Functions
export const shuffleArray = <T>(array: T[]): T[] => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

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


export class GeminiService {
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
