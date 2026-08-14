
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
                await prisma.users.update({
                    where: {
                        users_id: userId,
                    },
                    data: {
                        users_fname   : body.users_fname,
                        users_sname   : body.users_sname,
                        users_pin     : body.users_pin,
                        users_number  : body.users_number,
                        users_moo     : body.users_moo,
                        users_road    : body.users_road,
                        users_tubon   : body.users_tubon,
                        users_amphur  : body.users_amphur,
                        users_province: body.users_province,
                        users_postcode: body.users_postcode,
                        users_tel1    : body.users_tel1,
                        users_tel_home: body.users_tel_home,
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
