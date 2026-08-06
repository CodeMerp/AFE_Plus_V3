import crypto from 'crypto';

/**
 * AES-128-CBC + PKCS7 padding
 *
 * Key: 16 bytes (เก็บใน env AES_SHARED_KEY เป็น hex 32 ตัวอักษร)
 * IV : 16 bytes random ใหม่ทุกครั้ง (ส่งคู่กับ ciphertext แบบ base64)
 *
 * ใช้กับ smartwatch (Kotlin) ที่ใช้ "AES/CBC/PKCS5Padding" — compatible กัน
 */

const ALGORITHM = 'aes-128-cbc';

function getKey(): Buffer {
    const hex = process.env.AES_SHARED_KEY;
    if (!hex || hex.length !== 32) {
        throw new Error('AES_SHARED_KEY must be set as 32-char hex string (16 bytes)');
    }
    return Buffer.from(hex, 'hex');
}

/**
 * ถอดรหัส ciphertext + iv (รับเป็น base64) → คืน plaintext (string)
 */
export function decryptAES(ciphertextB64: string, ivB64: string): string {
    const key = getKey();
    const iv = Buffer.from(ivB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
}

/**
 * เข้ารหัส plaintext → คืน { iv, ciphertext } (base64 ทั้งคู่)
 * (สำหรับเทส backend หรือถ้าต้องส่งข้อมูลกลับ smartwatch แบบเข้ารหัส)
 */
export function encryptAES(plaintext: string): { iv: string; ciphertext: string } {
    const key = getKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
        iv: iv.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
    };
}
