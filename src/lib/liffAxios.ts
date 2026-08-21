import axios from 'axios';
import liff from '@line/liff';

/**
 * ติดตั้ง axios interceptor — แนบ LINE ID Token (Bearer) ทุก request อัตโนมัติ
 *
 * เรียกครั้งเดียวใน _app.tsx (browser-only)
 * หลังจากนั้น `axios.get/post(...)` ทั่วโปรเจคจะแนบ token ให้เอง
 *   → frontend ไม่ต้องแก้รายไฟล์ → merge ง่าย
 */
let installed = false;

/** true เมื่อ url ชี้กลับมาที่ API ของระบบเอง (relative หรือ origin เดียวกัน) */
function isOwnApi(url?: string) {
    if (!url) return false;
    try {
        return new URL(url, window.location.origin).origin === window.location.origin;
    } catch {
        return false;
    }
}

export function setupAxiosAuth() {
    if (installed) return;
    if (typeof window === 'undefined') return; // browser-only
    installed = true;

    axios.interceptors.request.use(async (config) => {
        // แนบเฉพาะ request ที่ยิงกลับมาที่ API ของระบบเอง
        // ไม่งั้น LINE ID Token / auToken จะหลุดไปกับ request ที่ยิงไปโดเมนอื่น
        if (!isOwnApi(config.url)) return config;

        try {
            if (liff.isLoggedIn?.()) {
                const token = liff.getIDToken();
                if (token && !config.headers.Authorization) {
                    config.headers.Authorization = `Bearer ${token}`;
                }
            }
        } catch {
            // liff ยังไม่ init / ไม่ได้อยู่ใน LIFF — ข้าม
        }

        // หน้าที่เปิดจาก rich menu ไม่ได้ init LIFF จึงไม่มี ID Token
        // แต่ทุกหน้ามี `auToken` (LINE user id) อยู่ใน URL — ส่งไปให้ฝั่ง server ระบุตัวตนแทน
        const auToken = new URLSearchParams(window.location.search).get('auToken');
        if (auToken && !config.headers['x-au-token']) {
            config.headers['x-au-token'] = auToken;
        }

        return config;
    });
}
