import React, { useState } from 'react';
import { Button } from './common/Button';
import { Card } from './common/Card';

interface AuthScreenProps {
    onLogin: (name: string, apiKey: string) => void;
    error: string | null;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin, error }) => {
    const [name, setName] = useState('');
    const [apiKey, setApiKey] = useState('');

    const handleLoginClick = () => {
        if(name.trim() && apiKey.trim()) {
            onLogin(name.trim(), apiKey.trim());
        }
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
            <Card className="max-w-md w-full text-center animate-fade-in-up">
                <h1 className="text-3xl font-bold text-slate-100 mb-2">Gemini English Tutor</h1>
                <p className="text-slate-400 mb-8">Войдите, чтобы начать обучение</p>
                
                <form onSubmit={(e) => { e.preventDefault(); handleLoginClick(); }} className='space-y-4'>
                    <div>
                        <label htmlFor="name-input" className="sr-only">Ваше имя</label>
                        <input 
                            id="name-input"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Введите ваше имя"
                            required
                            className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                    </div>
                     <div>
                        <label htmlFor="api-key-input" className="sr-only">Gemini API Key</label>
                        <input 
                            id="api-key-input"
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="Введите ваш Gemini API ключ"
                            required
                            className="w-full bg-slate-700 border border-slate-600 rounded-md px-4 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                    </div>

                    {error && (
                        <p className="text-red-400 text-sm">{error}</p>
                    )}

                    <Button 
                        type="submit"
                        variant="primary" 
                        className="w-full text-lg py-3"
                        disabled={!name.trim() || !apiKey.trim()}
                    >
                        Войти
                    </Button>
                </form>
                <p className="text-xs text-slate-500 mt-4">
                   Ваш API ключ хранится только в вашем браузере.
                </p>
            </Card>
        </div>
    );
};

export default AuthScreen;
