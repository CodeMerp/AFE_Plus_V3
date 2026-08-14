
import { NextApiRequest, NextApiResponse } from 'next'
import { NextResponse } from 'next/server'
import axios from "axios";
import { withRlsAuth } from '@/lib/withRlsAuth'
import { decrypt } from '@/utils/helpers'
type Data = {
    message: string;
    data?: any;
}
export default withRlsAuth(
    async function handle(req: NextApiRequest, res: NextApiResponse, prisma) {
    if (req.method === 'POST') {
        try {
            const id = decrypt(req.query.id as string);
            if (req.body && id) {
                const body = req.body
                const userId = parseInt(id, 10);
                await prisma.takecareperson.update({
                    where: {
                        takecare_id: userId,
                    },
                    data: {
                        takecare_fname   : body.takecare_fname,
                        takecare_sname   : body.takecare_sname,
                        takecare_birthday: body.takecare_birthday,
                        gender_id        : Number(body.gender_id),
                        marry_id         : Number(body.marry_id),
                        takecare_number  : body.takecare_number,
                        takecare_moo     : body.takecare_moo,
                        takecare_road    : body.takecare_road,
                        takecare_tubon   : body.takecare_tubon,
                        takecare_amphur  : body.takecare_amphur,
                        takecare_province: body.takecare_province,
                        takecare_postcode: body.takecare_postcode,
                        takecare_tel1    : body.takecare_tel1,
                        takecare_tel_home: body.takecare_tel_home,
                        takecare_disease : body.takecare_disease,
                        takecare_drug    : body.takecare_drug,
                    },
                })

            }
            return res.status(200).json({ message: 'success' })
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
