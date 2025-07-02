import { CEFRLevel } from './types.ts';

export const CEFR_LEVELS_ORDER: CEFRLevel[] = [
    CEFRLevel.A1,
    CEFRLevel.A2,
    CEFRLevel.B1,
    CEFRLevel.B2,
    CEFRLevel.C1,
];

// Progression System Constants
export const PROGRESS_HISTORY_LENGTH = 100;
export const PROGRESS_UNLOCK_THRESHOLD = 80;
export const LEVEL_UP_TEST_QUESTIONS = 50;
export const LEVEL_UP_PASS_PERCENTAGE = 0.8;