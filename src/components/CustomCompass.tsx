import React from 'react';

interface CustomCompassProps {
    bearing: number;
    onTap: () => void;
    size?: number;
}

export default function CustomCompass({ bearing, onTap, size = 55 }: CustomCompassProps) {
    return (
        <div
            onClick={onTap}
            className="bg-white rounded-full flex items-center justify-center cursor-pointer transition-shadow hover:shadow-lg"
            style={{
                width: size,
                height: size,
                boxShadow: '0 2px 10px rgba(0,0,0,0.12)' // BoxShadow สีดำอ่อนแบบ Flutter[cite: 1]
            }}
        >
            <div
                style={{
                    transform: `rotate(${-bearing}deg)`,
                    transition: 'transform 0.3s ease-out',
                    width: '100%',
                    height: '100%',
                    position: 'relative'
                }}
            >
                <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-sm">
                    {/* Top-Left Red */}
                    <polygon points="50,12.5 50,50 36,50" fill="#EF5350" />
                    {/* Top-Right Red */}
                    <polygon points="50,12.5 64,50 50,50" fill="#E53935" />
                    {/* Bottom-Left Grey */}
                    <polygon points="50,87.5 50,50 36,50" fill="#6B6B6B" />
                    {/* Bottom-Right Grey */}
                    <polygon points="50,87.5 64,50 50,50" fill="#4A4A4A" />
                </svg>
            </div>
        </div>
    );
}