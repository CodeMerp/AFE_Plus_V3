import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  console.log('getUserCaregiver called, id=', id, 'method=', req.method);
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'missing id' });

  const backend = process.env.WEB_DOMAIN;
  if (!backend) {
    // Provide a safe local fallback so the frontend can function in dev without backend
    const mock = {
      data: {
        takecare_number: '12',
        takecare_moo: '3',
        takecare_road: 'สุขสวัสดิ์',
        takecare_tubon: 'บางปู',
        takecare_amphur: 'เมือง',
        takecare_province: 'สมุทรปราการ',
        takecare_postcode: '10280',
        takecare_tel1: '0812345678',
        takecare_tel_home: ''
      }
    };
    return res.status(200).json(mock);
  }

  try {
    const url = `${backend}/api/user/getUserCaregiver/${encodeURIComponent(String(id))}`;
    const response = await axios.get(url, { headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' } });
    return res.status(response.status).json(response.data);
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data || { message: err.message };
    return res.status(status).json(data);
  }
}
