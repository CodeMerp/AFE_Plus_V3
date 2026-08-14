
import { NextApiRequest, NextApiResponse } from 'next'
import { NextResponse } from 'next/server'
import axios from "axios";
import { withRls } from '@/lib/withRls'
import { decrypt } from '@/utils/helpers'

export default withRls(
    req => {
        const id = decrypt(req.query.id as string)
        const v = Array.isArray(id) ? id[0] : id
        return v ? Number(v) : null
    },
    async function handle(req: NextApiRequest, res: NextApiResponse, prisma) {
    if (req.method === 'GET') {
        try {
            // const id = req.query.id
            const id = decrypt(req.query.id as string);
            if(id){
                const userId = Array.isArray(id) ? parseInt(id[0], 10) : parseInt(id, 10);
                if (!isNaN(userId)) {
                    const user = await prisma.takecareperson.findFirst({
                        where: {
                            users_id: userId,
                            takecare_status: 1,
                        },
                        include: { // ถ้าไม่ใส่ include จะไม่เอาข้อมูลจากตารางอื่นมาด้วย
                            gender_id_ref:{
                                select:{
                                    gender_describe: true
                                }
                            },
                            marry_id_ref:{
                                select:{
                                    marry_describe: true
                                }
                            },
                            // users_status_id: true, // ถ้าไม่ใส่ select จะเอาทุก field
                        },
                    })
                    return res.status(200).json({ message: 'success', data: user })
                }
            }
            return res.status(400).json({ message: 'error', data: 'ไม่สามารถดึงข้อมูลได้' })
            
        } catch (error) {
            return res.status(400).json({ message: 'error', data: error })
        }

    } else {
        res.setHeader('Allow', ['GET'])
        res.status(400).json({ message: `วิธี ${req.method} ไม่อนุญาต` })
    }

}
);
