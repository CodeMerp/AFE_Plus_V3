import { NextApiRequest, NextApiResponse } from 'next'
import { withRlsAuth } from '@/lib/withRlsAuth'
import _ from 'lodash'

type Data = {
    message: string;
    data?: any;
}

export default withRlsAuth(
    async function handle(req: NextApiRequest, res: NextApiResponse, prisma) {
    if (req.method === 'POST') {
        try {
            if (req.body) {
                const body = req.body

                if (_.isNaN(Number(body.takecare_id)) || _.isNaN(Number(body.users_id))) {
                    return res.status(400).json({ message: 'error', data: 'พารามิเตอร์ takecare_id หรือ users_id ไม่ใช่ตัวเลข' })
                }

                // เช็คค่าที่ส่งมาว่าเป็นตัวเลข
                if (body.id && _.isNaN(Number(body.id))) {
                    return res.status(400).json({ message: 'error', data: 'พารามิเตอร์ id ไม่ใช่ตัวเลข' })
                }

                const minBpm = Number.isFinite(Number(body.min_bpm)) ? Number(body.min_bpm) : 55;
                const minEnabled = body.min_enable !== undefined ? Boolean(body.min_enable) : true;

                if (body.id) {
                    await prisma.heartrate_settings.update({
                        where: { id: Number(body.id) },
                        data: {
                            max_bpm: Number(body.max_bpm),
                            min_bpm: minBpm,
                            min_enable: minEnabled,
                        },
                    });
                    return res.status(200).json({ message: 'success' });
                }

                const existing = await prisma.heartrate_settings.findFirst({
                    where: {
                        users_id: Number(body.users_id),
                        takecare_id: Number(body.takecare_id),
                    },
                });

                if (existing) {
                    await prisma.heartrate_settings.update({
                        where: { id: existing.id },
                        data: {
                            max_bpm: Number(body.max_bpm),
                            min_bpm: minBpm,
                            min_enable: minEnabled,
                        },
                    });
                    return res.status(200).json({ message: 'success', id: existing.id });
                } else {
                    const createdHeartRate = await prisma.heartrate_settings.create({
                        data: {
                            takecare_id: Number(body.takecare_id),
                            users_id: Number(body.users_id),
                            max_bpm: Number(body.max_bpm),
                            min_bpm: minBpm,
                            min_enable: minEnabled,
                        }
                    });
                    return res.status(200).json({ message: 'success', id: createdHeartRate.id });
                }
            }
            return res.status(400).json({ message: 'error', data: 'error' });
        } catch (error) {
            console.error("Error in heartrate settings API:", error);
            return res.status(400).json({ message: 'error', data: error });
        }
    } else {
        res.setHeader('Allow', ['POST']);
        res.status(400).json({ message: `วิธี ${req.method} ไม่อนุญาต` });
    }
}
);
