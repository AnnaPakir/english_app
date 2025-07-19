
import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
}

export const Card: React.FC<CardProps> = ({ children, className = '' }) => (<div className={`bg-gray-900/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6 shadow-lg ${className}`}>{children}</div>);
