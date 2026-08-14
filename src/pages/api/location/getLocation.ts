
import { NextApiRequest, NextApiResponse } from 'next'
import { NextResponse } from 'next/server'
import axios from "axios";
import { withRlsAuth } from '@/lib/withRlsAuth'
import _ from "lodash";

export default withRlsAuth(
    async function handle(req: NextApiRequest, res: NextApiResponse, prisma) {
    if (req.method === 'GET') {
        try {
            const { users_id, takecare_id } = req.query;

            if (!users_id || !takecare_id || isNaN(Number(users_id)) || isNaN(Number(takecare_id))) {
                return res.status(400).json({ message: 'error', data: 'พารามิเตอร์ไม่ถูกต้อง' });
            }

            // ดึงตำแหน่งล่าสุด
            const latestLocation = await prisma.location.findFirst({
                where: {
                    users_id: Number(users_id),
                    takecare_id: Number(takecare_id),
                },
                orderBy: {
                    location_id: 'desc', // เรียงลำดับตาม location_id จากล่าสุด
                },
            });

            if (!latestLocation) {
                return res.status(404).json({ message: 'error', data: 'ไม่พบตำแหน่งล่าสุด' });
            }

            return res.status(200).json({
                message: 'success',
                data: latestLocation,
            });
        } catch (error) {
            console.error("Error:", error);
            return res.status(500).json({ message: 'error', data: 'เกิดข้อผิดพลาดในการประมวลผล' });
        }
    } else {
        res.setHeader('Allow', ['GET']);
        res.status(405).json({ message: `วิธี ${req.method} ไม่อนุญาต` });
    }
}
);
