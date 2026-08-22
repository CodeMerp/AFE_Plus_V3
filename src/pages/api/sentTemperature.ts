import { NextApiRequest, NextApiResponse } from 'next';
import { withRls } from '@/lib/withRls'
import { withAesDecrypt } from '@/lib/withAesDecrypt'
import _ from 'lodash';
import { replyNotificationPostbackTemp } from '@/utils/apiLineReply';
import moment from 'moment';

type Data = {
    message: string;
    data?: any;
};

export default withAesDecrypt(withRls(
    req => Number(req.body?.uId),
    async function handle(req: NextApiRequest, res: NextApiResponse<Data>, prisma) {
        if (req.method === 'PUT' || req.method === 'POST') {
            try {
                const body = req.body;

                console.log('========== SEND TEMPERATURE ==========');
                console.log('Request body:', body);
                console.log('uId:', body?.uId);
                console.log('takecare_id:', body?.takecare_id);
                console.log('temperature_value:', body?.temperature_value);
                console.log('status:', body?.status);
                
                if (!body.uId || !body.takecare_id || !body.temperature_value) {
                    return res.status(400).json({ message: 'error', data: 'ไม่พบพารามิเตอร์ uId, takecare_id, temperature_value' });
                }

                if (_.isNaN(Number(body.uId)) || _.isNaN(Number(body.takecare_id)) || _.isNaN(Number(body.status))) {
                    return res.status(400).json({ message: 'error', data: 'พารามิเตอร์ uId, takecare_id, status ไม่ใช่ตัวเลข' });
                }

                const user = await prisma.users.findFirst({
                    where: { users_id: Number(body.uId) },
                    include: {
                        users_status_id: {
                            select: { status_name: true }
                        }
                    }
                });

                const takecareperson = await prisma.takecareperson.findFirst({
                    where: {
                        takecare_id: Number(body.takecare_id),
                        takecare_status: 1
                    }
                });

                if (!user || !takecareperson) {
                    return res.status(200).json({ message: 'error', data: 'ไม่พบข้อมูล user หรือ takecareperson' });
                }

                const settingTemp = await prisma.temperature_settings.findFirst({
                    where: {
                        takecare_id: takecareperson.takecare_id,
                        users_id: user.users_id
                    }
                });

                const temperatureValue = Number(body.temperature_value);
                let calculatedStatus = Number(body.status);

                if (settingTemp && temperatureValue > settingTemp.max_temperature) {
                    calculatedStatus = 1;
                } else {
                    calculatedStatus = 0;
                }

                const status = calculatedStatus;

                const temp = await prisma.temperature_records.findFirst({
                    where: {
                        users_id: user.users_id,
                        takecare_id: takecareperson.takecare_id
                    },
                    orderBy: {
                        noti_time: 'desc'
                    }
                });

                // Keep previous notification state by default, then override only when needed.
                let noti_time: Date | null = temp?.noti_time ?? null;
                let noti_status: number | null = temp?.noti_status ?? 0;

                const minutesSinceLastNoti = temp?.noti_time
                    ? moment().diff(moment(temp.noti_time), 'minutes')
                    : null;

                const shouldNotify =
                    status === 1 && (
                        !temp ||
                        temp.noti_status !== 1 ||
                        !temp.noti_time ||
                        (minutesSinceLastNoti !== null && minutesSinceLastNoti >= 5)
                    );

                if (shouldNotify) {
                    const message = `คุณ ${takecareperson.takecare_fname} ${takecareperson.takecare_sname} \nอุณหภูมิร่างกายเกินค่าที่กำหนด`;

                    const replyToken = user.users_line_id || '';
                    if (replyToken) {
                        await replyNotificationPostbackTemp({
                            replyToken,
                            userId: user.users_id,
                            takecarepersonId: takecareperson.takecare_id,
                            type: 'temperature',
                            message
                        });
                    }

                    noti_status = 1;
                    noti_time = new Date();
                    console.log('Temperature notification sent');
                } else if (status === 1) {
                    console.log(`Skip temperature notification: still in cooldown (${minutesSinceLastNoti ?? 0} minute(s))`);
                }

                if (status === 0) {
                    noti_status = 0;
                    noti_time = null;
                    console.log("อุณหภูมิอยู่ในระดับปกติ");
                }

                if (temp) {
                    await prisma.temperature_records.update({
                        where: {
                            temperature_id: temp.temperature_id
                        },
                        data: {
                            temperature_value: temperatureValue,
                            record_date: new Date(),
                            status: status,
                            noti_time: noti_time,
                            noti_status: noti_status
                        }
                    });
                } else {
                    await prisma.temperature_records.create({
                        data: {
                            users_id: user.users_id,
                            takecare_id: takecareperson.takecare_id,
                            temperature_value: temperatureValue,
                            record_date: new Date(),
                            status: status,
                            noti_time: noti_time,
                            noti_status: noti_status
                        }
                    });
                }

                return res.status(200).json({ message: 'success', data: 'บันทึกข้อมูลเรียบร้อย' });

            } catch (error) {
                console.error("🚀 ~ API /temperature error:", error);
                return res.status(400).json({ message: 'error', data: error });
            }
        } else {
            res.setHeader('Allow', ['PUT', 'POST']);
            return res.status(405).json({ message: 'error', data: `วิธี ${req.method} ไม่อนุญาต` });
        }
    }
));