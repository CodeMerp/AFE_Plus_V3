
import { NextApiRequest, NextApiResponse } from 'next'
import { NextResponse } from 'next/server'
import axios from "axios";
import prisma from '@/lib/prisma'

export default async function handle(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'GET') {
        try {
            // Development-only: return mock data if no DB configured
            if (process.env.NODE_ENV === 'development') {
                const mock = [
                    { gender_id: 1, gender_describe: 'ชาย' },
                    { gender_id: 2, gender_describe: 'หญิง' }
                ];
                return res.status(200).json({ message: 'success', data: mock })
            }
            const gender = await prisma.gender.findMany()

            return res.status(200).json({ message: 'success', data: gender })
        } catch (error) {
            return res.status(400).json({ message: 'error', data: error })
        }

    } else {
        res.setHeader('Allow', ['GET'])
        res.status(400).json({ message: `วิธี ${req.method} ไม่อนุญาต` })
    }

}
