
import { NextApiRequest, NextApiResponse } from 'next'
import { NextResponse } from 'next/server'
import axios from "axios";
import { withRlsAuth } from '@/lib/withRlsAuth'
import { decrypt } from '@/utils/helpers'
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

                if (body.setting_id && _.isNaN(Number(body.setting_id))) {
                    return res.status(400).json({ message: 'error', data: 'พารามิเตอร์ id ไม่ใช่ตัวเลข' })
                }
                if (body.setting_id) {

                    await prisma.temperature_settings.update({
                        where: { setting_id: Number(body.setting_id) },
                        data: { max_temperature: Number(body.max_temperature) },
                    });
                    return res.status(200).json({ message: 'success' });
                }
                const existing =  await prisma.temperature_settings.findFirst({
                    where: {
                        users_id: Number(body.users_id),
                        takecare_id: Number(body.takecare_id),
                    },
                });
                if (existing) {
                    await prisma.temperature_settings.update({
                        where: {
                            setting_id: existing.setting_id,
                        },
                        data: {
                            max_temperature: Number(body.max_temperature),
                        },
                    });
                    return res.status(200).json({ message: 'success', id: existing.setting_id });
                }

                else {
                    const createdTemperature = await prisma.temperature_settings.create({
                        data: {
                            takecare_id: Number(body.takecare_id),
                            users_id: Number(body.users_id),
                            max_temperature: Number(body.max_temperature),
                        }
                    })
                    return res.status(200).json({ message: 'success', id: createdTemperature.setting_id })
                }
            }
            return res.status(400).json({ message: 'error', data: 'error' })
        } catch (error) {
            console.error("Error in temperature settings API:", error)
            return res.status(400).json({ message: 'error', data: error })
        }
    } else {
        res.setHeader('Allow', ['POST'])
        res.status(400).json({ message: `วิธี ${req.method} ไม่อนุญาต` })
    }
}
);
