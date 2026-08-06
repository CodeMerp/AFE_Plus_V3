/**
 * Verify LINE ID Token กับ LINE API
 * คืน sub (LINE user ID) ถ้า token ถูกต้อง, null ถ้าผิด/หมดอายุ
 */
export async function verifyLineToken(idToken: string): Promise<string | null> {
    try {
        const params = new URLSearchParams();
        params.append('id_token', idToken);
        params.append('client_id', process.env.LINE_LOGIN_CHANNEL_ID || '');

        const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        const data = await res.json();
        if (!res.ok || data.error) return null;
        return data.sub as string;
    } catch (e) {
        console.error('verifyLineToken error:', e);
        return null;
    }
}
