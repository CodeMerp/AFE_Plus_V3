import { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * ห่อ query ด้วย transaction ที่ตั้งค่า app.current_user_id ให้ก่อน
 * เพื่อให้ Postgres RLS policy อ่านค่า user_id ได้ผ่าน current_setting()
 *
 * ใช้ set_config(..., true) เพื่อให้ค่าอยู่แค่ใน transaction เดียว
 * (กันรั่วข้าม connection ใน Prisma connection pool)
 */
export async function withUserContext<T>(
    userId: number,
    fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
    return prisma.$transaction(async (tx) => {
        // ต้อง SET ROLE ก่อน — connection ต่อด้วย postgres ซึ่งเป็น superuser + BYPASSRLS
        // ไม่สลับ role = policy ทั้ง 28 ตัวไม่มีผล (เหมือนใน withRls.ts)
        await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${String(userId)}, true)`;
        return fn(tx);
    });
}
