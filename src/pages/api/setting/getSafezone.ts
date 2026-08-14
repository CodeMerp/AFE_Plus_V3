
import { NextApiRequest, NextApiResponse } from 'next'
import { NextResponse } from 'next/server'
import axios from "axios";
import { withRls } from '@/lib/withRls'
import _ from "lodash";

export default withRls(
    req => Number(req.query.users_id),
    async function handle(req: NextApiRequest, res: NextApiResponse, prisma) {
    if (req.method === 'GET') {
        try {
            const takecare_id = req.query.takecare_id
            const users_id = req.query.users_id
            const id = req.query.id
            if(_.isNaN(Number(takecare_id)) || _.isNaN(Number(users_id))){
                return res.status(400).json({ message: 'error', data: 'พารามิเตอร์ takecare_id หรือ users_id ไม่ใช่ตัวเลข' })
            }
            let safezone = null
            if(id){
                safezone = await prisma.safezone.findFirst({
                    where: {
                        safezone_id: Number(id)
                    }
                })
            }else{
                safezone = await prisma.safezone.findFirst({
                    where: {
                        takecare_id: Number(takecare_id),
                        users_id: Number(users_id),
                    }
                })
            }
            

            return res.status(200).json({ message: 'success', data: safezone })
        } catch (error) {
            return res.status(400).json({ message: 'error', data: error })
        }

    } else {
        res.setHeader('Allow', ['GET'])
        res.status(400).json({ message: `วิธี ${req.method} ไม่อนุญาต` })
    }

}
);
