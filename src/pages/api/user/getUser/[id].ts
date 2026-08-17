
import { NextApiRequest, NextApiResponse } from 'next'
import { NextResponse } from 'next/server'
import axios from "axios";
import prisma from '@/lib/prisma'

export default async function handle(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'GET') {
        try {
            const id_line = req.query.id
            console.log('Querying user with LINE ID:', id_line)
            
            const user = await prisma.users.findFirst({
                where: {
                    users_line_id: id_line as string,
                    users_status_active: 1,
                },
                include: { // ถ้าไม่ใส่ include จะไม่เอาข้อมูลจากตารางอื่นมาด้วย
                    users_status_id:{
                        select:{
                            status_name: true
                        }
                    },
                    // users_status_id: true, // ถ้าไม่ใส่ select จะเอาทุก field
                },
            })

            console.log('User found:', user ? 'YES' : 'NO')
            return res.status(200).json({ message: 'success', data: user })
        } catch (error) {
            console.error('Database error:', error)
            return res.status(500).json({ 
                message: 'error', 
                data: error instanceof Error ? error.message : 'Unknown error' 
            })
        }

    } else {
        res.setHeader('Allow', ['GET'])
        res.status(405).json({ message: `วิธี ${req.method} ไม่อนุญาต` })
    }

}
