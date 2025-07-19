
import React from 'react';

interface ButtonProps {
    children: React.ReactNode;
    onClick: () => void;
    className?: string;
    disabled?: boolean;
    variant?: 'primary' | 'secondary';
}

export const Button: React.FC<ButtonProps> = ({ children, onClick, className = '', disabled = false, variant = 'primary' }) => {
    const baseClasses = 'px-6 py-3 font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
    const variantClasses = {
        primary: 'bg-indigo-500 hover:bg-indigo-600 text-white focus:ring-indigo-400',
        secondary: 'bg-gray-700 hover:bg-gray-600 text-gray-200 focus:ring-gray-500',
    };
    return (<button type="button" onClick={onClick} className={`${baseClasses} ${variantClasses[variant]} ${className}`} disabled={disabled}>{children}</button>);
};
