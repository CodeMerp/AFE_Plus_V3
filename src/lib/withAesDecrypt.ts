import { NextApiRequest, NextApiResponse } from 'next';
import { decryptAES } from './aesCrypto';

/**
 * ห่อ handler — ถอดรหัส body ที่เข้ารหัสมาจาก smartwatch ก่อน
 *
 * Body ที่ smartwatch ส่งมา:
 *   { "iv": "<base64>", "ciphertext": "<base64>" }
 *
 * หลัง decrypt → req.body กลายเป็น JSON ปกติ เช่น
 *   { uId, takecare_id, temperature_value, status }
 *
 * → handler ภายในเขียนเหมือนต้นฉบับ ไม่ต้องรู้จัก AES
 *   (merge-friendly เหมือน withRls)
 */
export function withAesDecrypt(handler: any) {
    return async (req: NextApiRequest, res: NextApiResponse) => {
        if (req.method === 'POST' || req.method === 'PUT') {
            try {
                const body = req.body || {};
                const { iv, ciphertext } = body;

                if (!iv || !ciphertext) {
                    return res.status(400).json({
                        message: 'error',
                        data: 'Missing iv or ciphertext in body'
                    });
                }

                const plaintext = decryptAES(ciphertext, iv);
                req.body = JSON.parse(plaintext);
            } catch (e) {
                console.error('AES decrypt failed:', e);
                return res.status(400).json({
                    message: 'error',
                    data: 'Decryption failed — invalid ciphertext or key mismatch'
                });
            }
        }
        return handler(req, res);
    };
}
