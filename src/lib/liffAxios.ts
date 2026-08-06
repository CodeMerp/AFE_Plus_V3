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

export function setupAxiosAuth() {
    if (installed) return;
    if (typeof window === 'undefined') return; // browser-only
    installed = true;

    axios.interceptors.request.use(async (config) => {
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
        return config;
    });
}
