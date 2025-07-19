
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card } from './common/Card';
import { GoogleUser } from '../types';
import { GOOGLE_CLIENT_ID } from '../constants';

interface AuthScreenProps {
    onAuth: (user: GoogleUser) => void;
}

const useAuth = () => {
    const [user, setUser] = useState<GoogleUser | null>(null);

    const handleCredentialResponse = useCallback((response: any) => {
        const decoded = JSON.parse(atob(response.credential.split('.')[1]));
        setUser({
            name: decoded.name,
            email: decoded.email,
            picture: decoded.picture
        });
    }, []);

    useEffect(() => {
        if (window.google?.accounts?.id) {
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleCredentialResponse,
            });
        }
    }, [handleCredentialResponse]);

    const renderGoogleButton = useCallback((ref: React.RefObject<HTMLDivElement>) => {
        if (window.google?.accounts?.id && ref.current) {
             window.google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large" });
        }
    }, []);

    return { user, renderGoogleButton };
};

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuth }) => {
    const googleButtonRef = useRef<HTMLDivElement>(null);
    const auth = useAuth();
    
    useEffect(() => {
        const interval = setInterval(() => {
            if (googleButtonRef.current && window.google?.accounts?.id && googleButtonRef.current.childElementCount === 0) {
                 auth.renderGoogleButton(googleButtonRef);
                 clearInterval(interval);
            }
        }, 100);
        return () => clearInterval(interval);
    }, [auth]);

    useEffect(() => {
        if (auth.user) {
            onAuth(auth.user);
        }
    }, [auth.user, onAuth]);

    return (
        <div className="min-h-screen flex items-center justify-center fade-in">
            <Card className="text-center">
                <h1 className="text-3xl font-bold mb-2">Gemini English Tutor</h1>
                <p className="text-gray-400 mb-6">Your personal AI-powered language learning partner.</p>
                <div ref={googleButtonRef}></div>
            </Card>
        </div>
    );
};
