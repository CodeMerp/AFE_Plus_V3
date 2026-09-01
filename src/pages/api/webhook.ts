import { NextApiRequest, NextApiResponse } from 'next'
import { NextResponse } from 'next/server'
import axios from "axios";
import prisma from '@/lib/prisma'
import { replyMessage, replyRegistration, replyUserData, replyNotRegistration, replyMenuBorrowequipment, replyConnection, replyLocation, replySetting, replyUserInfo, replyNotification, replyMapCoordinates } from '@/utils/apiLineReply';
import { replyNotification as replyNotificationToGroup } from '@/utils/apiLineGroup';
import { encrypt, parseQueryString } from '@/utils/helpers'
import { postbackSafezone, postbackAccept, postbackClose } from '@/lib/lineFunction'
import * as api from '@/lib/listAPI'

type Data = {
  message: string;
  data?: any;
}

const getUser = async (userId: string) => {
  const responseUser = await axios.get(`${process.env.WEB_DOMAIN}/api/user/getUser/${userId}`);
  if (responseUser.data?.data) {
    return responseUser.data.data;
  } else {
    return null;
  }
}

const getGroupLine = async (groupId: string) => {
  const response = await axios.get(`${process.env.WEB_DOMAIN}/api/master/getGroupLine?group_line_id=${groupId}`);
  if (response.data?.data) {
    return response.data.data;
  } else {
    return null;
  }
}

const addGroupLine = async (groupId: string) => {
  const response = await axios.post(`${process.env.WEB_DOMAIN}/api/master/getGroupLine`, { group_line_id: groupId, group_name: '' });
  if (response.data?.id) {
    return response.data.id;
  } else {
    return null;
  }
}

const getUserTakecareperson = async (userId: string) => {
  const responseUser = await axios.get(`${process.env.WEB_DOMAIN}/api/user/getUserTakecareperson/${userId}`, {
    headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' }
  });
  if (responseUser.data?.data) {
    return responseUser.data.data;
  } else {
    return null;
  }
}

const getSafezone = async (takecare_id: number, users_id: number) => {
  const response = await axios.get(`${process.env.WEB_DOMAIN}/api/setting/getSafezone?takecare_id=${takecare_id}&users_id=${users_id}`, {
    headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' }
  });
  if (response.data?.data) {
    return response.data.data;
  } else {
    return null;
  }
}

const getLocation = async (takecare_id: number, users_id: number, safezone_id: number) => {
  const response = await axios.get(`${process.env.WEB_DOMAIN}/api/location/getLocation?takecare_id=${takecare_id}&users_id=${users_id}&safezone_id=${safezone_id}`, {
    headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' }
  });
  if (response.data?.data) {
    return response.data.data;
  } else {
    return null;
  }
}

export default async function handle(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `วิธี ${req.method} ไม่อนุญาต` });
  }

  try {
    const eventsRoot = req.body.events && req.body.events[0];
    if (!eventsRoot) return res.status(200).json({ message: 'no events' });

    const events: any = eventsRoot;
    const replyToken = events.replyToken;
    const userId = events.source?.userId;

    // Handle group join: ensure group registered
    if (events.source?.type === 'group' && events.type === 'join') {
      const groupLine = await getGroupLine(events.source.groupId);
      if (!groupLine) await addGroupLine(events.source.groupId);
    }

    // Message (text) handling from user
    if (events.type === 'message' && events.source?.type === 'user' && events.message?.type === 'text') {
      const text = events.message.text;
      if (text === 'ลงทะเบียน') {
        const responseUser = await api.getUser(userId);
        if (responseUser) await replyUserData({ replyToken, userData: responseUser });
        else await replyRegistration({ replyToken, userId });
        return res.status(200).json({ message: 'ok' });
      }

      if (text === 'การยืม-คืนอุปกรณ์') {
        const responseUser = await api.getUser(userId);
        if (responseUser) await replyMenuBorrowequipment({ replyToken, userData: responseUser });
        else await replyNotRegistration({ replyToken, userId });
        return res.status(200).json({ message: 'ok' });
      }

      if (text === 'การเชื่อมต่อนาฬิกา') {
        const responseUser = await api.getUser(userId);
        if (responseUser) {
          const encodedUsersId = encrypt(responseUser.users_id.toString());
          const responseUserTakecareperson = await getUserTakecareperson(encodedUsersId);
          if (responseUserTakecareperson) await replyConnection({ replyToken, userData: responseUser, userTakecarepersonData: responseUserTakecareperson });
          else await replyMessage({ replyToken, message: 'ยังไม่ได้เพิ่มข้อมูลผู้มีภาวะพึ่งพิงไม่สามารถเชื่อมต่อนาฬิกาได้' });
        } else {
          await replyNotRegistration({ replyToken, userId });
        }
        return res.status(200).json({ message: 'ok' });
      }

      if (text === 'ดูตำแหน่งปัจจุบัน') {
        const responseUser = await api.getUser(userId);
        if (responseUser) {
          const encodedUsersId = encrypt(responseUser.users_id.toString());
          const responseUserTakecareperson = await getUserTakecareperson(encodedUsersId);
          if (responseUserTakecareperson) {
            const responeSafezone = await getSafezone(responseUserTakecareperson.takecare_id, responseUser.users_id);
            if (responeSafezone) {
              const responeLocation = await getLocation(responseUserTakecareperson.takecare_id, responseUser.users_id, responeSafezone.safezone_id);
              await replyLocation({ replyToken, userData: responseUser, userTakecarepersonData: responseUserTakecareperson, safezoneData: responeSafezone, locationData: responeLocation });
            } else {
              await replyMessage({ replyToken, message: 'ยังไม่ได้ตั้งค่าเขตปลอดภัยไม่สามารถดูตำแหน่งปัจจุบันได้' });
            }
          } else {
            await replyMessage({ replyToken, message: 'ยังไม่ได้เพิ่มข้อมูลผู้มีภาวะพึ่งพิงไม่สามารถดูตำแหน่งปัจจุบิงได้' });
          }
        } else {
          await replyNotRegistration({ replyToken, userId });
        }
        return res.status(200).json({ message: 'ok' });
      }

      if (text === 'ตั้งค่าเขตปลอดภัย' || text === 'ตั้งค่าความปลอดภัย') {
        const responseUser = await api.getUser(userId);
        if (responseUser) {
          const encodedUsersId = encrypt(responseUser.users_id.toString());
          const responseUserTakecareperson = await getUserTakecareperson(encodedUsersId);
          const responeSafezone = await getSafezone(responseUserTakecareperson?.takecare_id, responseUser.users_id);
          await replySetting({ replyToken, userData: responseUser, userTakecarepersonData: responseUserTakecareperson, safezoneData: responeSafezone });
        } else {
          await replyNotRegistration({ replyToken, userId });
        }
        return res.status(200).json({ message: 'ok' });
      }

      if (text === 'ดูข้อมูลผู้ใช้งาน') {
        const responseUser = await api.getUser(userId);
        if (responseUser) {
          const encodedUsersId = encrypt(responseUser.users_id.toString());
          const responseUserTakecareperson = await getUserTakecareperson(encodedUsersId);
          await replyUserInfo({ replyToken, userData: responseUser, userTakecarepersonData: responseUserTakecareperson });
        } else {
          await replyNotRegistration({ replyToken, userId });
        }
        return res.status(200).json({ message: 'ok' });
      }
    }

    // Postback handling
    if (events.type === 'postback' && events.postback?.data) {
      console.log('Postback Data: ', events.postback.data);
      const postback = parseQueryString(events.postback.data);
      console.log('Parsed Postback: ', postback);

      if (postback.action === 'show_map') {
        await replyMapCoordinates({ toLineId: events.source.userId, extenId: postback.extenId || postback.exten_id, takecareId: postback.takecare_id || postback.takecareId });
        return res.status(200).json({ message: 'ok' });
      }

      if (postback.type === 'safezone' || postback.type === 'alert') {
        const result: any = await postbackSafezone({ userLineId: postback.userLineId, takecarepersonId: Number(postback.takecarepersonId) });

        // legacy behavior: postbackSafezone may return string (users_line_id) or control strings
        if (result === 'already_sent') {
          await replyMessage({ replyToken, message: 'มีคำขอความช่วยเหลือที่ยังไม่ปิดอยู่แล้ว' });
        } else if (result === 'in_safezone') {
          await replyMessage({ replyToken, message: 'อยู่ในเขตปลอดภัยไม่สามารถส่งคำขอได้' });
        } else if (typeof result === 'string' && result.length > 0) {
          // old postbackSafezone returns the user's line id after sending group notification itself
          await replyMessage({ replyToken, message: 'ส่งคำขอความช่วยเหลือแล้ว' });
        } else if (result && result.status === 'ok') {
          // new structured result: webhook is responsible for pushing to group
          try {
            await replyNotificationToGroup({ resUser: result.resUser, resTakecareperson: result.resTakecareperson, resSafezone: result.resSafezone, extendedHelpId: result.extendedHelpId, locationData: result.locationData });
            await replyMessage({ replyToken, message: 'ส่งคำขอความช่วยเหลือแล้ว' });
          } catch (err) {
            console.error('Failed to notify group:', err);
            await replyMessage({ replyToken, message: 'ส่งคำขอความช่วยเหลือล้มเหลว' });
          }
        } else {
          await replyMessage({ replyToken, message: 'ไม่สามารถส่งคำขอได้ กรุณาตรวจสอบการตั้งค่า Safezone หรือข้อมูลผู้ดูแล' });
        }
        return res.status(200).json({ message: 'ok' });
      }

      if (postback.type === 'accept') {
        let data = postback;
        data.groupId = events.source?.groupId;
        data.userIdAccept = events.source?.userId;
        const replyTokenGroup = await postbackAccept(data);
        if (replyTokenGroup) await replyNotification({ replyToken: replyTokenGroup, message: 'ตอบรับเคสขอความช่วยเหลือแล้ว' });
        return res.status(200).json({ message: 'ok' });
      }

      if (postback.type === 'close') {
        let data = postback;
        data.groupId = events.source?.groupId;
        data.userIdAccept = events.source?.userId;
        const replyTokenGroup = await postbackClose(data);
        if (replyTokenGroup) await replyNotification({ replyToken: replyTokenGroup, message: 'ปิดเคสขอความช่วยเหลือแล้ว' });
        return res.status(200).json({ message: 'ok' });
      }
    }

    return res.status(200).json({ message: 'success' });
  } catch (error) {
    console.error('Error handling request: ', error);
    const replyToken = req.body?.events?.[0]?.replyToken;
    if (replyToken) await replyMessage({ replyToken, message: 'ระบบขัดข้องกรุณาลองใหม่อีกครั้ง' });
    return res.status(500).json({ message: 'error' });
  }
}