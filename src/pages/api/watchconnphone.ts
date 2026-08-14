
import { NextApiRequest, NextApiResponse } from 'next'
import { NextResponse } from 'next/server'
import axios from "axios";
import { withRls } from '@/lib/withRls'
import { decrypt } from '@/utils/helpers'
import _ from 'lodash'
type Data = {
    message: string;
    data?: any;
}
export default withRls(
    req => Number(req.query?.uId),
    async function handle(req: NextApiRequest, res: NextApiResponse, prisma) {

    if (req.method === 'GET') {
        try {
           const query = req.query
           if(!query.uId || !query.uPin){
            return res.status(400).json({ message: 'error', data: 'ไม่พบพารามิเตอร์ uId หรือ uPin' })
           }

           if(_.isNaN(Number(query.uId)) || _.isNaN(Number(query.uPin))){
            return res.status(400).json({ message: 'error', data: 'พารามิเตอร์ uId หรือ uPin ไม่ใช่ตัวเลข' })
           }
           const user = await prisma.users.findFirst({
                where: {
                    users_id : Number(query.uId),
                    users_pin: Number(query.uPin),
                },
                include: { // ถ้าไม่ใส่ include จะไม่เอาข้อมูลจากตารางอื่นมาด้วย
                    users_status_id:{
                        select:{
                            status_name: true
                        }
                    }
                    // users_status_id: true, // ถ้าไม่ใส่ select จะเอาทุก field
                },
            })

            let takecareperson = null
            if(user){
                takecareperson = await prisma.takecareperson.findFirst({
                    where: {
                        users_id : user.users_id  as number,
                        takecare_status : 1
                    }
                })
            }

            if(user && takecareperson){
                const safezone = await prisma.safezone.findFirst({
                    where: {
                        takecare_id: takecareperson.takecare_id  as number,
                        users_id   : user.users_id  as number,
                    }
                })
                if(safezone){
                    return res.status(200).json({ status: true, lat: safezone.safez_latitude, long: safezone.safez_longitude, r1: safezone.safez_radiuslv1, r2: safezone.safez_radiuslv2, takecare_id: takecareperson.takecare_id })
                }
                return res.status(200).json({ status: true, lat: "0", long: "0", r1: 0, r2: 0, takecare_id: takecareperson.takecare_id })
            }else{
                return res.status(200).json({ status: false, lat: "0", long: "0", r1: 0, r2: 0, takecare_id: 0 })
            }
        } catch (error) {
            console.log("🚀 ~ file: create.ts:31 ~ handle ~ error:", error)
            return res.status(400).json({ message: 'error', data: error })
        }

    } else {
        res.setHeader('Allow', ['GET'])
        res.status(400).json({ message: `วิธี ${req.method} ไม่อนุญาต` })
    }

}
);
