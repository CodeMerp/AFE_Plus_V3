import { NextApiRequest, NextApiResponse } from 'next';
import { withRls } from '@/lib/withRls'
import { withAesDecrypt } from '@/lib/withAesDecrypt'
import _ from 'lodash';
import { replyNotificationPostback ,replyNotificationPostbackfall} from '@/utils/apiLineReply';
import axios from 'axios';
import moment from 'moment';

const LINE_PUSH_MESSAGING_API = 'https://api.line.me/v2/bot/message/push';
const LINE_HEADER = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CHANNEL_ACCESS_TOKEN_LINE}`,
};

type Data = {
    message: string;
    data?: any;
};

export default withAesDecrypt(withRls(
    req => Number(req.body?.users_id),
    async function handle(req: NextApiRequest, res: NextApiResponse<Data>, prisma) {
    if (req.method === 'PUT' || req.method === 'POST') {
        try {
            const body = req.body;

            if (
                body.users_id === undefined || body.users_id === null ||
                body.takecare_id === undefined || body.takecare_id === null ||
                body.x_axis === undefined ||
                body.y_axis === undefined ||
                body.z_axis === undefined ||
                body.fall_status === undefined ||
                body.latitude === undefined ||
                body.longitude === undefined
            ) {
                return res.status(400).json({ message: 'error', data: 'Missing parameter: users_id, takecare_id, x_axis, y_axis, z_axis, fall_status, latitude, longitude' });
            }

            if (
                _.isNaN(Number(body.users_id)) ||
                _.isNaN(Number(body.takecare_id)) ||
                _.isNaN(Number(body.fall_status))
            ) {
                return res.status(400).json({ message: 'error', data: 'users_id, takecare_id, fall_status ต้องเป็นตัวเลข' });
            }

            const user = await prisma.users.findFirst({
                where: { users_id: Number(body.users_id) }
            });

            const takecareperson = await prisma.takecareperson.findFirst({
                where: { takecare_id: Number(body.takecare_id), takecare_status: 1 }
            });

            if (!user || !takecareperson) {
                return res.status(200).json({ message: 'error', data: 'ไม่พบข้อมูล user หรือ takecareperson' });
            }

         
            const lastFall = await prisma.fall_records.findFirst({
                where: {
                    users_id: user.users_id,
                    takecare_id: takecareperson.takecare_id
                },
                orderBy: { noti_time: 'desc' }
            });

            const fallStatus = Number(body.fall_status);
            let noti_time: Date | null = null;
            let noti_status: number | null = null;

           
            if ((fallStatus === 2 || fallStatus === 3) && (
                !lastFall || lastFall.noti_status !== 1 || !lastFall.noti_time || moment().diff(moment(lastFall.noti_time), 'minutes') >= 5
            )) {
                const message = fallStatus === 2
                    ? `คุณ ${takecareperson.takecare_fname} ${takecareperson.takecare_sname} กด "ไม่โอเค" ขอความช่วยเหลือ`
                    : `คุณ ${takecareperson.takecare_fname} ${takecareperson.takecare_sname} ไม่มีการตอบสนองภายใน 30 วินาที`;

                const replyToken = user.users_line_id || '';
                if (replyToken) {
          
                    await replyNotificationPostbackfall({
                        replyToken,
                        userId: user.users_id,
                        takecarepersonId: takecareperson.takecare_id,
                        type: 'fall',
                        message
                    });

                   
                    const latitude = Number(body.latitude);
                    const longitude = Number(body.longitude);

                    const locationRequest = {
                        to: replyToken,
                        messages: [
                            {
                                type: "location",
                                title: `ตำแหน่งที่ล้มล่าสุด`,
                                address: `ตำแหน่งที่ล้มของ ${takecareperson.takecare_fname} ${takecareperson.takecare_sname}`,
                                latitude: latitude,
                                longitude: longitude
                            }
                        ]
                    };
                    await axios.post(LINE_PUSH_MESSAGING_API, locationRequest, { headers: LINE_HEADER });
                }

                noti_status = 1;
                noti_time = new Date();
            } else {
                noti_status = 0;
                noti_time = null;
                console.log("ล้มแต่ยังไม่เข้าเงื่อนไขแจ้งเตือน LINE หรือแจ้งไปแล้วใน 5 นาที");
            }

          
            await prisma.fall_records.create({
                data: {
                    users_id: user.users_id,
                    takecare_id: takecareperson.takecare_id,
                    x_axis: Number(body.x_axis),
                    y_axis: Number(body.y_axis),
                    z_axis: Number(body.z_axis),
                    fall_latitude: body.latitude,
                    fall_longitude: body.longitude,
                    fall_status: fallStatus,
                    noti_time: noti_time,
                    noti_status: noti_status
                }
            });

            return res.status(200).json({ message: 'success', data: 'บันทึกข้อมูลเรียบร้อย' });

        } catch (error) {
            console.error("API /sentFall error:", error);
            return res.status(400).json({ message: 'error', data: error });
        }
    } else {
        res.setHeader('Allow', ['PUT', 'POST']);
        return res.status(405).json({ message: 'error', data: `วิธี ${req.method} ไม่อนุญาต` });
    }
}
));
