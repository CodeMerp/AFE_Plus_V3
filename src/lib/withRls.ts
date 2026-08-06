import { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import basePrisma from './prisma';

type RlsPrisma = Prisma.TransactionClient | typeof basePrisma;

type Handler = (
    req: NextApiRequest,
    res: NextApiResponse,
    prisma: RlsPrisma
) => Promise<any> | any;

type GetUserId = (req: NextApiRequest) => number | null | undefined;

/**
 * ห่อ Next.js API handler — set RLS context อัตโนมัติ
 *
 * วิธีใช้:
 *   export default withRls(
 *     req => Number(req.body.users_id),
 *     async function handle(req, res, prisma) {
 *       // ใช้ prisma ตามปกติ — query ทุกตัวจะมี RLS context ให้แล้ว
 *     }
 *   );
 */
export function withRls(getUserId: GetUserId, handler: Handler) {
    return async (req: NextApiRequest, res: NextApiResponse) => {
        const userId = getUserId(req);

        if (!userId || isNaN(userId)) {
            // ไม่มี userId → ตัดจบตรงนี้ ห้ามรันด้วย connection ที่ไม่มี RLS context
            // (ก่อนหน้านี้ปล่อยผ่านด้วย basePrisma — รอดเพราะ RLS คืน 0 แถว
            //  แต่ถ้ารันด้วย role ที่เป็นเจ้าของตาราง จะ bypass policy ทั้งหมด)
            return res.status(401).json({ message: 'error', data: 'Unauthorized: Cannot determine user' });
        }

        return basePrisma.$transaction(async (tx) => {
            // ต้อง SET ROLE ก่อน — connection string ต่อด้วย postgres ซึ่งเป็น superuser + BYPASSRLS
            // ถ้าไม่สลับ role, policy ทุกตัวถูกข้าม (FORCE ROW LEVEL SECURITY กันได้แค่ owner ที่ไม่ใช่ superuser)
            await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
            await tx.$executeRaw`SELECT set_config('app.current_user_id', ${String(userId)}, true)`;
            return handler(req, res, tx);
        });
    };
}
