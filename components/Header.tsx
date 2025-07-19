
import React from 'react';
import { GoogleUser } from '../types';

interface HeaderProps {
    user: GoogleUser | null;
    onSignOut: () => void;
}

const IconWrapper = ({ children, className = '' }: { children: React.ReactNode, className?: string }) => <div className={`flex-shrink-0 ${className}`}>{children}</div>;
const ArrowRightOnRectangleIcon = ({ className = "w-6 h-6" }) => (<IconWrapper><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}><path fillRule="evenodd" d="M7.5 3.75A1.5 1.5 0 006 5.25v13.5a1.5 1.5 0 001.5 1.5h6a1.5 1.5 0 001.5-1.5V15a.75.75 0 011.5 0v3.75a3 3 0 01-3 3h-6a3 3 0 01-3-3V5.25a3 3 0 013-3h6a3 3 0 013 3V9A.75.75 0 0115 9V5.25a1.5 1.5 0 00-1.5-1.5h-6zm10.72 4.72a.75.75 0 011.06 0l3 3a.75.75 0 010 1.06l-3 3a.75.75 0 11-1.06-1.06l1.72-1.72H9a.75.75 0 010-1.5h10.94l-1.72-1.72a.75.75 0 010-1.06z" clipRule="evenodd" /></svg></IconWrapper>);


export const Header: React.FC<HeaderProps> = ({ user, onSignOut }) => (
    <header className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center bg-gray-950/50 backdrop-blur-sm z-10">
        <h1 className="text-xl font-bold">Gemini Tutor</h1>
        {user && (
            <div className="flex items-center gap-4">
                 <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full" />
                <div>
                    <p className="font-semibold">{user.name}</p>
                    <p className="text-sm text-gray-400">{user.email}</p>
                </div>
                <button type="button" onClick={onSignOut} className="text-gray-400 hover:text-white" aria-label="Sign out">
                   <ArrowRightOnRectangleIcon />
                </button>
            </div>
        )}
    </header>
);
