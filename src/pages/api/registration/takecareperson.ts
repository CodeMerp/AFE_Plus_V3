
import { NextApiRequest, NextApiResponse } from 'next'
import prisma from '@/lib/prisma'

type Data = {
    message: string;
    data?: any;
}

export default async function handle(req: NextApiRequest, res: NextApiResponse<Data>) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST'])
        res.status(405).json({ message: `วิธี ${req.method} ไม่อนุญาต` })
        return;
    }

    try {
        const body = req.body;
        if (!body) {
            return res.status(400).json({ message: 'error', data: 'No request body' })
        }

        if (!body.users_id || !body.takecare_fname || !body.takecare_sname || !body.takecare_birthday || !body.gender_id || !body.marry_id) {
            return res.status(400).json({
                message: 'error',
                data: 'Missing required registration fields'
            })
        }

        await prisma.takecareperson.create({
            data: {
                users_id: Number(body.users_id),
                takecare_fname: body.takecare_fname,
                takecare_sname: body.takecare_sname,
                takecare_birthday: new Date(body.takecare_birthday),
                gender_id: Number(body.gender_id),
                marry_id: Number(body.marry_id),
                takecare_number: body.takecare_number,
                takecare_moo: body.takecare_moo,
                takecare_road: body.takecare_road,
                takecare_tubon: body.takecare_tubon,
                takecare_amphur: body.takecare_amphur,
                takecare_province: body.takecare_province,
                takecare_postcode: body.takecare_postcode,
                takecare_tel1: body.takecare_tel1,
                takecare_tel_home: body.takecare_tel_home,
                takecare_disease: body.takecare_disease,
                takecare_drug: body.takecare_drug,
                takecare_status: 1
            },
        })

        return res.status(200).json({ message: 'success' })
    } catch (error) {
        console.log('🚀 ~ file: takecareperson.ts ~ handle ~ error:', error)
        return res.status(400).json({ message: 'error', data: error })
    }
}
