import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AssessmentQuestion, CEFRLevel, LearningTask, TaskEvaluation } from "../types.ts";
import { LEVEL_UP_TEST_QUESTIONS } from "../constants.ts";

const parseJsonResponse = <T,>(text: string): T | null => {
    let jsonStr = text.trim();
    const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
    const match = jsonStr.match(fenceRegex);
    if (match && match[2]) {
        jsonStr = match[2].trim();
    }

    try {
        return JSON.parse(jsonStr) as T;
    } catch (e) {
        console.error("Failed to parse JSON response:", e, "Raw text:", text);
        return null;
    }
};

export class GeminiService {
    private ai: GoogleGenAI;

    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("API key is required to initialize GeminiService");
        }
        this.ai = new GoogleGenAI({ apiKey });
    }

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
            const response: GenerateContentResponse = await this.ai.models.generateContent({
                model: "gemini-2.5-flash-preview-04-17",
                contents: prompt,
                config: { responseMimeType: "application/json", temperature: 0.7 },
            });

            const questions = parseJsonResponse<AssessmentQuestion[]>(response.text);
            if (!questions || !Array.isArray(questions) || questions.length < 30) {
                console.error("Received invalid data from API:", questions);
                throw new Error("Could not generate a valid assessment test.");
            }
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
        
        The response must be only the JSON array.
        `;
        try {
             const response: GenerateContentResponse = await this.ai.models.generateContent({
                model: "gemini-2.5-flash-preview-04-17",
                contents: prompt,
                config: { responseMimeType: "application/json", temperature: 0.8 },
            });

            const questions = parseJsonResponse<AssessmentQuestion[]>(response.text);
            if (!questions || !Array.isArray(questions) || questions.length < LEVEL_UP_TEST_QUESTIONS) {
                console.error("Received invalid data for level up test:", questions);
                throw new Error("Could not generate a valid level-up test.");
            }
            return questions.slice(0, LEVEL_UP_TEST_QUESTIONS);
        } catch (error) {
            console.error(`Error generating level-up test for ${level}:`, error);
            throw new Error("Failed to communicate with the AI for the level-up test.");
        }
    }

    async generateLearningTask(level: CEFRLevel, feedbackHistory: string[]): Promise<LearningTask | null> {
        const feedbackPrompt = feedbackHistory.length > 0 
            ? `
            CRITICAL: The user has provided the following feedback on previous tasks. You MUST take this into account to personalize the experience.
            - Avoid topics or tasks the user finds boring or unhelpful.
            - Prioritize topics or task types the user finds useful or interesting.
            - Here is the user's feedback history (most recent first):
            ${feedbackHistory.slice(-5).reverse().map(f => `- "${f}"`).join('\n')}
            `
            : '';
        
        const prompt = `
        Create a single English learning task for a user at the ${level} CEFR level.
        The difficulty, vocabulary, and grammar MUST be strictly appropriate for the ${level} level. Do not give tasks that are too easy or too hard.

        ${feedbackPrompt}

        Randomly choose one of the following task types: 'reading', 'vocabulary', 'grammar', 'image', 'dialogue', 'story', 'editing'.

        Return the result as a single, well-formed JSON object. The response must be only the JSON object.
        The JSON object MUST include a "level": "${level}" field.

        Here are the structures for each type:

        1. For 'reading', 'vocabulary', 'grammar', 'image' (Quiz-based tasks):
           - Structure: { "type": "string", "title": "string", "level": "${level}", "content": "string", "questions": [{ "question": "string", "options": ["...", "...", "..."], "correctAnswer": "string" }] }
           - 'reading': 'content' is a short text, 'questions' has 1-2 questions about it.
           - 'vocabulary': 'content' is a sentence with "___", 'questions' has one question to fill the blank.
           - 'grammar': 'content' is an incorrect sentence, 'questions' has one question with corrected options.
           - 'image': 'content' is a scene description in Russian. 'questions' has one question with 4 English prompts to choose from to generate an image.

        2. For 'dialogue' (Interactive task):
           - Structure: { "type": "dialogue", "title": "Dialogue Completion", "level": "${level}", "context": "string (e.g., 'You are at a cafe')", "content": "string (the first character's line)", "constraints": "string (e.g., 'Use the Present Perfect tense and the word 'delicious'.')" }

        3. For 'story' (Interactive task):
           - Structure: { "type": "story", "title": "Creative Story Writing", "level": "${level}", "content": "A short prompt like 'Write a short, coherent story (2-3 paragraphs) using all the given words and the grammar rule.'", "words": ["word1", "word2", "word3", "word4", "word5"], "grammarConstraint": "string (e.g., 'Must include a sentence with 'used to'.')" }

        4. For 'editing' (Interactive task):
           - Structure: { "type": "editing", "title": "Translation Editing", "level": "${level}", "originalText": "string (a short text in Russian)", "content": "string (a non-ideal, somewhat literal English translation of originalText)", "constraints": "Edit the English translation to make it more natural, idiomatic, and grammatically correct." }
        `;

        try {
            const response: GenerateContentResponse = await this.ai.models.generateContent({
                model: "gemini-2.5-flash-preview-04-17",
                contents: prompt,
                config: { responseMimeType: "application/json", temperature: 1.0 },
            });
            
            const task = parseJsonResponse<LearningTask>(response.text);
            if (!task || !task.type || !task.title || !task.content) {
                 throw new Error("Generated task is missing required fields.");
            }
            return task;
        } catch (error) {
            console.error("Error generating learning task:", error);
            throw new Error("Failed to generate a new learning task.");
        }
    }
    
    async evaluateTextTask(task: LearningTask, userInput: string): Promise<TaskEvaluation> {
        let prompt = `An English learner at the ${task.level} level was given a task. Please evaluate their response.
        Provide your evaluation as a JSON object with this exact structure: { "isCorrect": boolean, "feedback": "string" }.
        The feedback MUST be in simple Russian. It should be encouraging and clearly explain what was done well and what could be improved.

        Task Type: ${task.type}
        User's Response: "${userInput}"
        `;

        switch (task.type) {
            case 'dialogue':
                prompt += `
                Context: "${task.context}"
                Initial Line: "${task.content}"
                Constraints: "${task.constraints}"
                Evaluation criteria: Is the user's response a logical continuation of the dialogue? Is it grammatically correct? Does it fulfill all constraints?
                `;
                break;
            case 'story':
                prompt += `
                Words to use: ${task.words?.join(', ')}
                Grammar constraint: "${task.grammarConstraint}"
                Evaluation criteria: Does the story use ALL the given words? Does it correctly use the grammar constraint? Is the story coherent and grammatically correct for the user's level?
                `;
                break;
            case 'editing':
                prompt += `
                Original Russian Text: "${task.originalText}"
                Imperfect English Translation to be edited: "${task.content}"
                Evaluation criteria: Is the user's edited version a more natural, idiomatic, and grammatically correct translation than the original imperfect one? Explain why their version is better or what could still be improved.
                `;
                break;
            default:
                return { isCorrect: false, feedback: "Неверный тип задания для оценки." };
        }

        try {
            const response = await this.ai.models.generateContent({
                model: "gemini-2.5-flash-preview-04-17",
                contents: prompt,
                config: { responseMimeType: "application/json" },
            });
            const evaluation = parseJsonResponse<TaskEvaluation>(response.text);
            if (!evaluation || typeof evaluation.isCorrect !== 'boolean' || !evaluation.feedback) {
                throw new Error("Invalid evaluation format from AI.");
            }
            return evaluation;
        } catch (error) {
            console.error("Error evaluating text task:", error);
            return { isCorrect: false, feedback: "Не удалось оценить ваш ответ. Пожалуйста, попробуйте еще раз." };
        }
    }


    async getExplanation(question: string, correctAnswer: string, userAnswer: string): Promise<string> {
        const prompt = `An English learner was asked this question: "${question}". The correct answer is "${correctAnswer}". The learner incorrectly answered "${userAnswer}". Please provide a 1-2 sentence explanation in simple Russian about why the learner's answer is wrong.`;

        try {
            const response = await this.ai.models.generateContent({
                model: "gemini-2.5-flash-preview-04-17",
                contents: prompt,
            });
            return response.text;
        } catch (error) {
            console.error("Error getting explanation:", error);
            return "Не удалось получить объяснение.";
        }
    }

    async generateImage(prompt: string): Promise<string> {
        try {
            const response = await this.ai.models.generateImages({
                model: 'imagen-3.0-generate-002',
                prompt: prompt,
                config: {numberOfImages: 1, outputMimeType: 'image/jpeg'},
            });
    
            if (!response.generatedImages || response.generatedImages.length === 0) {
                throw new Error("API did not return any images.");
            }

            const base64ImageBytes: string = response.generatedImages[0].image.imageBytes;
            return `data:image/jpeg;base64,${base64ImageBytes}`;
        } catch (error) {
            console.error("Error generating image:", error);
            throw new Error("Failed to generate image. The model may have refused the prompt.");
        }
    }
}