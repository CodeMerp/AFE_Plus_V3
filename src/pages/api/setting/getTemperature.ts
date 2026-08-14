import { NextApiRequest, NextApiResponse } from 'next'
import { withRlsAuth } from '@/lib/withRlsAuth'
import _ from "lodash";

export default withRlsAuth(
    async function handle(req: NextApiRequest, res: NextApiResponse, prisma) {
  if (req.method === 'GET') {
    try {
      const takecare_id = req.query.takecare_id
      const users_id = req.query.users_id
      const setting_id = req.query.setting_id

      let temperature_settings = null

      if (setting_id) {
        console.log(" Query by setting_id:", setting_id);
        temperature_settings = await prisma.temperature_settings.findFirst({
          where: { setting_id: Number(setting_id) },
        });
      } else {
        if (_.isNaN(Number(takecare_id)) || _.isNaN(Number(users_id))) {
          return res.status(400).json({ message: 'error', data: 'พารามิเตอร์ takecare_id หรือ users_id ไม่ใช่ตัวเลข' });
        }

        console.log(" Query by users_id + takecare_id:", users_id, takecare_id);
        temperature_settings = await prisma.temperature_settings.findFirst({
          where: {
            users_id: Number(users_id),
            takecare_id: Number(takecare_id),
          },
        });
      }

      return res.status(200).json({ message: 'success', data: temperature_settings });

    } catch (error) {
      console.error(" Error fetching temperature settings:", error)
      return res.status(500).json({ message: 'error', data: error });
    }

  } else {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `วิธี ${req.method} ไม่อนุญาต` });
  }
}
);
