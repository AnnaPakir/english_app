import React from 'react';
import { CEFRLevel } from '../types.ts';
import { Button } from './common/Button.tsx';
import { Card } from './common/Card.tsx';

interface LevelUpResultsScreenProps {
    isSuccess: boolean;
    newLevel: CEFRLevel | null;
    onContinue: () => void;
}

const LevelUpResultsScreen: React.FC<LevelUpResultsScreenProps> = ({ isSuccess, newLevel, onContinue }) => {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <Card className="max-w-xl text-center animate-fade-in-up">
                {isSuccess ? (
                    <>
                        <h2 className="text-3xl font-bold text-green-400 mb-2">Поздравляем!</h2>
                        <p className="text-slate-300 text-lg mb-4">Вы успешно прошли тест и перешли на новый уровень:</p>
                        <div className="bg-green-600 text-white text-4xl font-bold rounded-lg py-4 px-8 inline-block mb-8">
                            {newLevel}
                        </div>
                        <p className="text-slate-400 mb-8">Ваш прогресс сброшен. Продолжайте в том же духе!</p>
                    </>
                ) : (
                    <>
                        <h2 className="text-3xl font-bold text-yellow-400 mb-2">Почти получилось!</h2>
                        <p className="text-slate-300 text-lg mb-4">К сожалению, в этот раз не удалось пройти тест.</p>
                        <p className="text-slate-400 mb-8">Не волнуйтесь! Ваш прогресс сброшен, и вы можете продолжить практиковаться на своем текущем уровне, чтобы попробовать снова.</p>
                    </>
                )}
                <Button onClick={onContinue} className="px-8 py-3 text-lg">
                    Продолжить обучение
                </Button>
            </Card>
        </div>
    );
};

export default LevelUpResultsScreen;