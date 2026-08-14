
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
                if(_.isNaN(Number(body.takecare_id)) || _.isNaN(Number(body.users_id))){
                    return res.status(400).json({ message: 'error', data: 'พารามิเตอร์ takecare_id หรือ users_id ไม่ใช่ตัวเลข' })
                }
                if(body.safezone_id && _.isNaN(Number(body.safezone_id))){
                    return res.status(400).json({ message: 'error', data: 'พารามิเตอร์ id ไม่ใช่ตัวเลข' })
                }
                if(body.safezone_id){
                    await prisma.safezone.update({
                        where: {
                            safezone_id: Number(body.safezone_id),
                        },
                        data: {
                            safez_latitude : body.safez_latitude,
                            safez_longitude: body.safez_longitude,
                            safez_radiuslv1: Number(body.safez_radiuslv1),
                            safez_radiuslv2: Number(body.safez_radiuslv2),
                        },
                    })
                    return res.status(200).json({ message: 'success' })
                }else{
                  const createdSafezone =  await prisma.safezone.create({
                        data: {
                            takecare_id    : Number(body.takecare_id),
                            users_id       : Number(body.users_id),
                            safez_latitude : body.safez_latitude,
                            safez_longitude: body.safez_longitude,
                            safez_radiuslv1: Number(body.safez_radiuslv1),
                            safez_radiuslv2: Number(body.safez_radiuslv2),
                        },
                    })
                    return res.status(200).json({ message: 'success', id: createdSafezone.safezone_id })
                }
            }
            return res.status(400).json({ message: 'error', data: 'error' })
        } catch (error) {
            console.log("🚀 ~ file: create.ts:31 ~ handle ~ error:", error)
            return res.status(400).json({ message: 'error', data: error })
        }

    } else {
        res.setHeader('Allow', ['POST'])
        res.status(400).json({ message: `วิธี ${req.method} ไม่อนุญาต` })
    }

}
);
