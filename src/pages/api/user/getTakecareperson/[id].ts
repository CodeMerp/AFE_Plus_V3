
import { NextApiRequest, NextApiResponse } from 'next'
import { NextResponse } from 'next/server'
import axios from "axios";
import { withRlsAuth } from '@/lib/withRlsAuth'
import { decrypt } from '@/utils/helpers'

export default withRlsAuth(
    async function handle(req: NextApiRequest, res: NextApiResponse, prisma) {
    if (req.method === 'GET') {
        try {
            const id = decrypt(req.query.id as string); // ถอดรหัส ID
            if (!id) {
                return res.status(400).json({ message: 'Invalid ID', data: null });
            }

            const takecarepersonId = Array.isArray(id) ? parseInt(id[0], 10) : parseInt(id, 10);
            if (isNaN(takecarepersonId)) {
                return res.status(400).json({ message: 'Invalid ID format', data: null });
            }

            // ค้นหา `takecareperson` โดยใช้ `takecare_id` หรือ `users_id`
            const response = await prisma.takecareperson.findFirst({
                where: {
                    OR: [
                        { takecare_id: takecarepersonId },
                        { users_id: takecarepersonId },
                    ],
                    takecare_status: 1,
                },
                include: {
                    gender_id_ref: {
                        select: { gender_describe: true },
                    },
                    marry_id_ref: {
                        select: { marry_describe: true },
                    },
                },
            });

            if (!response) {
                return res.status(404).json({ message: 'Data not found', data: null });
            }

            return res.status(200).json({ message: 'Success', data: response });
        } catch (error) {
            return res.status(500).json({ message: 'Error occurred', data: error });
        }
    } else {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: `วิธี ${req.method} ไม่อนุญาต` });
    }
}
);
