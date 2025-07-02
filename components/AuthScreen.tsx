import React, { useState } from 'react';
import { Button } from './common/Button.tsx';
import { Card } from './common/Card.tsx';

interface AuthScreenProps {
    onAuth: (name: string, apiKey: string) => void;
    error: string | null;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuth, error }) => {
    const [name, setName] = useState('');
    const [apiKey, setApiKey] = useState('');

    const handleAuthClick = () => {
        if(name.trim() && apiKey.trim()) {
            onAuth(name.trim(), apiKey.trim());
        }
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-900">
            <Card className="max-w-md w-full text-center animate-fade-in-up">
                <h1 className="text-3xl font-bold text-slate-100 mb-2">Gemini English Tutor</h1>
                <p className="text-slate-400 mb-8">Введите ваше имя и API ключ для начала.</p>
                
                <form onSubmit={(e) => { e.preventDefault(); handleAuthClick(); }} className='space-y-4'>
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
                        <label htmlFor="api-key-input" className="sr-only">Google AI API Key</label>
                        <input 
                            id="api-key-input"
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="Введите ваш Google AI API ключ"
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
            </Card>
        </div>
    );
};

export default AuthScreen;