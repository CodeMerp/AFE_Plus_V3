import React from 'react';
import { LucideIcon } from 'lucide-react'; // แนะนำให้ npm install lucide-react สำหรับ Icon ครับ

interface TopNavigationBannerProps {
    maneuverIcon: LucideIcon;
    distance?: number | null;
    instruction: string;
    subtitle?: string | null;
    action?: string | null;
    onAction?: () => void;
    isVisible?: boolean;
}

export default function TopNavigationBanner({
    maneuverIcon: Icon,
    distance,
    instruction,
    subtitle,
    action,
    onAction,
    isVisible = true,
}: TopNavigationBannerProps) {

    // ฟังก์ชันแปลงระยะทางให้แสดงผลแบบ กม. หรือ ม.[cite: 2]
    const formatDistance = (meters: number) => {
        if (meters >= 1000) {
            return `${(meters / 1000).toFixed(1)} กม.`;
        }
        return `${Math.max(1, Math.floor(meters))} ม.`;
    };

    const shouldShowDistance = typeof distance === 'number' && Number.isFinite(distance) && distance > 0;

    return (
        <div
            className={`fixed left-3 right-3 z-50 transition-all duration-400 ease-in-out ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
                }`}
            style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}
        >
            <div className="bg-[#0F5338] rounded-[18px] p-5 flex items-center shadow-[0_5px_12px_rgba(0,0,0,0.25)]">

                {/* ฝั่งซ้าย: Icon + ระยะทาง */}
                <div className="flex flex-col items-center min-w-[70px]">
                    <Icon color="white" size={48} />
                    {shouldShowDistance && (
                        <span className="text-white/80 text-base font-medium mt-1 font-kanit">
                            {formatDistance(distance)}
                        </span>
                    )}
                </div>

                <div className="w-5"></div> {/* Spacer 20px[cite: 2] */}

                {/* ฝั่งขวา: คำสั่งนำทาง */}
                <div className="flex-1">
                    <h1 className={`text-white text-[25px] font-semibold leading-[1.25] font-kanit ${subtitle ? 'line-clamp-1' : 'line-clamp-2'}`}>
                        {instruction}
                    </h1>
                    {subtitle && (
                        <p className="text-white/75 text-[14px] font-medium mt-0.5 font-kanit leading-snug line-clamp-1">
                            {subtitle}
                        </p>
                    )}
                    {action && onAction && (
                        <button
                            type="button"
                            onClick={onAction}
                            className="mt-1.5 rounded-full bg-white/20 px-3 py-1 text-[13px] font-semibold text-white active:scale-95"
                        >
                            {action}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
