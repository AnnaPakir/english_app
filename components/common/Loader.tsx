
import React from 'react';

interface LoaderProps {
    text: string;
}

export const Loader: React.FC<LoaderProps> = ({ text }) => (<div className="flex flex-col items-center justify-center space-y-4"><div className="dot-flashing"></div><p className="text-gray-400">{text}</p></div>);
