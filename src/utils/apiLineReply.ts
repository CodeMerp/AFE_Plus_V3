import axios from 'axios';
import moment from 'moment';
import prisma from '@/lib/prisma';
const WEB_API = process.env.WEB_API_URL;
const LINE_MESSAGING_API = 'https://api.line.me/v2/bot/message/reply';
const LINE_PUSH_MESSAGING_API = 'https://api.line.me/v2/bot/message/push';
const LINE_PROFILE_API = 'https://api.line.me/v2/bot/profile';
const LINE_HEADER = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CHANNEL_ACCESS_TOKEN_LINE}`, // Replace with your LINE Channel Access Token
};

export const replyMapCoordinates = async ({
    toLineId,
    extenId,
    takecareId,
}: { toLineId: string; extenId?: number | string; takecareId?: number | string }) => {
    try {
        // Determine target takecare_id either from provided takecareId or from extendedhelp record
        let targetTakecareId: number | undefined = takecareId ? Number(takecareId) : undefined;

        if (!targetTakecareId && extenId) {
            const ex = await prisma.extendedhelp.findUnique({ where: { exten_id: Number(extenId) } });
            if (ex?.takecare_id) targetTakecareId = Number(ex.takecare_id);
        }

        if (!targetTakecareId) {
            // nothing to show
            await axios.post(LINE_PUSH_MESSAGING_API, {
                to: toLineId,
                messages: [{ type: 'text', text: 'ไม่สามารถระบุตัวผู้ที่ต้องการแสดงตำแหน่งได้' }]
            }, { headers: LINE_HEADER });
            return;
        }

        // fetch takecareperson and latest location
        const takecare = await prisma.takecareperson.findUnique({ where: { takecare_id: targetTakecareId } });
        const takecareLoc = await prisma.location.findFirst({
            where: { takecare_id: targetTakecareId },
            orderBy: { locat_timestamp: 'desc' }
        });

        // fetch caregiver user by line id and their latest location (if any)
        const caregiverUser = await prisma.users.findFirst({ where: { users_line_id: toLineId } });
        const caregiverLoc = caregiverUser ? await prisma.location.findFirst({ where: { users_id: caregiverUser.users_id }, orderBy: { locat_timestamp: 'desc' } }) : null;

        const messages: any[] = [];

        if (takecareLoc) {
            messages.push({
                type: 'location',
                title: `ตำแหน่งผู้ที่มีภาวะพึ่งพิง ${takecare?.takecare_fname || ''} ${takecare?.takecare_sname || ''}`,
                address: `ตำแหน่งล่าสุด (${moment(takecareLoc.locat_timestamp).format('DD/MM/YYYY HH:mm')})`,
                latitude: Number(takecareLoc.locat_latitude),
                longitude: Number(takecareLoc.locat_longitude),
            });
        } else {
            messages.push({ type: 'text', text: 'ไม่พบพิกัดผู้ที่มีภาวะพึ่งพิงล่าสุด' });
        }

        if (caregiverLoc) {
            messages.push({
                type: 'location',
                title: `ตำแหน่งผู้ดูแล`,
                address: `ตำแหน่งล่าสุด (${moment(caregiverLoc.locat_timestamp).format('DD/MM/YYYY HH:mm')})`,
                latitude: Number(caregiverLoc.locat_latitude),
                longitude: Number(caregiverLoc.locat_longitude),
            });
        } else {
            messages.push({ type: 'text', text: 'ไม่พบพิกัดผู้ดูแลล่าสุด' });
        }

        const requestData = {
            to: toLineId,
            messages,
        };

        await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) console.log('replyMapCoordinates error:', error.message);
    }
};

interface ReplyMessage {
    replyToken: string;
    message: string;
}
interface ReplyRegistration {
    replyToken: string;
    userId: string;
}
interface ReplyNotification {
    replyToken: string;
    message: string;
    groupLineId?: string | null;
}
interface ReplyFlexMessage {
    replyToken: string;
    altText: string;
    contents: any;
}
interface ReplyNotificationPostback {
    userId: number;
    takecarepersonId: number;
    type: string;
    message: string;
    replyToken: string;
}
interface ReplyNotificationPostbackTemp {
    userId: number;
    takecarepersonId: number;
    type: string;
    message: string;
    replyToken: string;
}
interface ReplyNotificationPostbackfall {
    userId: number;
    takecarepersonId: number;
    type: string;
    message: string;
    replyToken: string;
}
interface ReplyNotificationPostbackHeart {
    userId: number;
    takecarepersonId: number;
    type: string;
    message: string;
    replyToken: string;
}
interface ReplyUserData {
    replyToken: string;
    userData: {
        users_id: string;
        users_line_id: string;
        users_fname: string;
        users_sname: string;
        users_pin: string;
        users_number: string;
        users_moo: string;
        users_road: string;
        users_tubon: string;
        users_amphur: string;
        users_province: string;
        users_postcode: string;
        users_tel1: string;
        users_tel_home: string;
        users_status_id: {
            status_name: string;
        }
    };
    userTakecarepersonData?: any;
}
interface ReplySettingData {
    replyToken: string;
    userData: {
        users_id: string;
        users_line_id: string;
        users_fname: string;
        users_sname: string;
        users_pin: string;
        users_number: string;
        users_moo: string;
        users_road: string;
        users_tubon: string;
        users_amphur: string;
        users_province: string;
        users_postcode: string;
        users_tel1: string;
        users_tel_home: string;
        users_status_id: {
            status_name: string;
        }
    };
    userTakecarepersonData?: any;
    safezoneData?: any;
    temperatureSettingData?: any;
    heartrateSettingData?: any;
}
interface ReplyLocationData {
    replyToken: string;
    userData: {
        users_id: string;
        users_line_id: string;
        users_fname: string;
        users_sname: string;
        users_pin: string;
        users_number: string;
        users_moo: string;
        users_road: string;
        users_tubon: string;
        users_amphur: string;
        users_province: string;
        users_postcode: string;
        users_tel1: string;
        users_tel_home: string;
        users_status_id: {
            status_name: string;
        }
    };
    userTakecarepersonData?: any;
    safezoneData?: any;
    locationData?: any;
}
// helper ทำแถวแบบ baseline (label : value) และรองรับกำหนดสี value
const baseline = (label: string, value: string, valueColor?: string) => ({
    type: 'box',
    layout: 'baseline',
    contents: [
        { type: 'text', text: label, size: 'sm', color: '#555555', flex: 3, wrap: true },
        { type: 'text', text: value, size: 'sm', color: valueColor || '#111111', flex: 5, wrap: true }
    ]
});
const layoutBoxBaseline = (label: string, text: string, flex1 = 2, flex2 = 5) => {
    return {
        type: "box",
        layout: "baseline",
        contents: [
            {
                type: "text",
                text: label,
                flex: flex1,
                size: "sm",
                color: "#AAAAAA"
            },
            {
                type: "text",
                text: text,
                flex: flex2,
                size: "sm",
                color: "#666666",
                wrap: true
            }
        ]
    }
}

// การ์ด KPI สำหรับค่า Vital (ตัวเลขใหญ่ + หน่วย)
const kpiBox = (label: string, value: string, unit: string, color: string) => ({
    type: 'box',
    layout: 'vertical',
    flex: 1,
    backgroundColor: '#F7F9FC',
    paddingAll: '12px',
    spacing: '6px',
    alignItems: 'center',
    contents: [
        { type: 'text', text: label, size: 'xs', color: '#6B7280' },
        { type: 'text', text: value, size: '3xl', weight: 'bold', color },
        { type: 'text', text: unit, size: 'xs', color: '#6B7280' }
    ]
});

const SAFEZONE_STATUS_CONFIG: Record<number, { color: string; title: string; detail: string }> = {
    0: { color: '#22C55E', title: '✅ ปลอดภัยแล้ว', detail: 'กลับเข้าสู่เขตปลอดภัย' },
    1: { color: '#FFA500', title: '⚠️ แจ้งเตือนระดับ 1', detail: 'ออกนอกเขตปลอดภัยชั้นที่ 1' },
    3: { color: '#FF8800', title: '🟠 เฝ้าระวังระดับ 2', detail: 'กำลังเข้าใกล้ขอบเขตชั้นที่ 2' },
    2: { color: '#FF0000', title: '🚨 อันตรายสูงสุด!', detail: 'ออกนอกเขตปลอดภัยชั้นที่ 2' },
};
const RED_ALERT_HEADER_COLOR = '#FF0000';
const CONSENT_NOTE_TEXT = '*หมาย: ข้าพเจ้ายินยอมเปิดเผยข้อมูลตำแหน่งปัจจุบันของผู้ที่มีภาวะพึ่งพิง';

const getRedAlertTemplate = ({
    title,
    message,
    postbackData,
    showConsentNote = false,
}: {
    title: string;
    message: string;
    postbackData?: string;
    showConsentNote?: boolean;
}) => {
    const bodyContents: any[] = [
        {
            type: 'text',
            text: message,
            wrap: true,
            size: 'md',
            color: '#555555',
        },
    ];

    if (postbackData) {
        bodyContents.push({
            type: 'button',
            style: 'primary',
            height: 'sm',
            margin: 'xxl',
            color: RED_ALERT_HEADER_COLOR,
            action: {
                type: 'postback',
                label: 'ส่งขอความช่วยเหลือเพิ่มเติม',
                data: postbackData,
            },
        });
    }

    if (showConsentNote) {
        bodyContents.push({
            type: 'text',
            wrap: true,
            lineSpacing: '5px',
            margin: 'md',
            text: CONSENT_NOTE_TEXT,
            color: '#ff0000',
            size: 'md',
        });
    }

    return {
        type: 'bubble',
        header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: RED_ALERT_HEADER_COLOR,
            paddingAll: '12px',
            contents: [
                {
                    type: 'text',
                    text: title,
                    color: '#FFFFFF',
                    size: 'lg',
                    weight: 'bold',
                    wrap: true,
                },
            ],
        },
        body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: bodyContents,
        },
    };
};

export const getFlexTemplate = (
    status: number,
    name: string,
    latitude: string,
    longitude: string,
    timeText: string,
    postbackData?: string,
    extendedHelpId?: number,
    resSafezone?: any,
    resUser?: { users_line_id: string }
) => {
    const config = SAFEZONE_STATUS_CONFIG[status] || SAFEZONE_STATUS_CONFIG[2];
    const contents: any[] = [
        {
            type: 'text',
            text: config.detail,
            size: 'sm',
            color: '#666666',
            wrap: true,
        },
        { type: 'separator', margin: 'md' },
        {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'sm',
            contents: [
                baseline('ชื่อผู้มีภาวะพึ่งพิง', name),
                baseline('พิกัดปัจจุบัน', `${latitude}, ${longitude}`),
                baseline('เวลาแจ้งเตือน', timeText),
            ],
        },
    ];

    if (postbackData) {
        contents.push(
            {
                type: 'button',
                style: 'primary',
                height: 'sm',
                margin: 'xxl',
                color: '#ff0000',  
                action: {
                    type: 'postback',
                    label: 'ส่งขอความช่วยเหลือเพิ่มเติม',
                    data: postbackData,
                },
            },
            {
                    type: 'button',
                    color: "#1976D2",
                    style: 'primary',
                    height: 'sm',
                    action: {
                        type: 'uri',
                        label: 'ดูแผนที่/นำทาง',
                        uri: `${WEB_API}/location?auToken=${resUser?.users_line_id || ''}&idsafezone=${resSafezone?.safezone_id || ''}&idlocation=${extendedHelpId || ''}`
                    },
                },
            {
                type: "text",
                wrap: true,
                lineSpacing: "5px",
                margin: "md",
                contents: [
                    {
                        type: "span",
                        text: "*หมาย: ข้าพเจ้ายินยอมเปิดเผยข้อมูลตำแหน่งปัจจุบันของผู้ที่มีภาวะพึ่งพิง",
                        color: "#ff0000",
                        size: "sm",
                        // decoration: "none",
                        // wrap      : true
                    }
                ]
            },
        );
    }

    return {
        type: 'bubble',
        header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: config.color,
            paddingAll: '12px',
            contents: [
                {
                    type: 'text',
                    text: config.title,
                    color: '#FFFFFF',
                    size: 'lg',
                    weight: 'bold',
                    wrap: true,
                },
            ],
        },
        body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents,
        },
    };
};

export const getUserProfile = async (userId: string) => {
    try {
        const response = await axios.get(`${LINE_PROFILE_API}/${userId}`, { headers: LINE_HEADER });
        return response.data;
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const replyMessage = async ({
    replyToken,
    message
}: ReplyMessage) => {
    try {
        const requestData = {
            replyToken,
            messages: [
                {
                    type: 'text',
                    text: message,
                },
            ],
        };

        const response = await axios.post(LINE_MESSAGING_API, requestData, { headers: LINE_HEADER });
        return response.data;
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const pushMessage = async ({
    replyToken,
    message
}: ReplyMessage) => {
    try {
        const requestData = {
            to: replyToken,
            messages: [
                {
                    type: 'text',
                    text: message,
                },
            ],
        };

        const response = await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
        return response.data;
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const replyMainMenu = async ({
    replyToken,
    userData
}: ReplyUserData) => {
    try {
        const profile = await getUserProfile(userData.users_line_id);
        const requestData = {
            replyToken,
            messages: [
                {
                    type: 'flex',
                    altText: 'เมนูทั้งหมดของ AFE PLUS',
                    contents: {
                        type: 'carousel',
                        contents: [
                            {
                                type: 'bubble',
                                body: {
                                    type: 'box',
                                    layout: 'vertical',
                                    contents: [
                                        { type: 'text', text: 'ฟีเจอร์หลัก', weight: 'bold', size: 'xl', color: '#1DB446' },
                                        { type: 'text', text: 'บริการและอุปกรณ์ Smartwatch', size: 'xs', color: '#aaaaaa', margin: 'sm' }
                                    ]
                                },
                                footer: {
                                    type: 'box', layout: 'vertical', spacing: 'sm', contents: [
                                        { type: 'button', style: 'primary', color: '#1DB446', action: { type: 'message', label: 'ข้อมูลสุขภาพ & ตำแหน่ง', text: 'ข้อมูลสุขภาพและตำแหน่ง' } },
                                        { type: 'button', style: 'primary', color: '#1DB446', action: { type: 'message', label: 'เชื่อมต่อนาฬิกา', text: 'เชื่อมต่อนาฬิกา' } },
                                        { type: 'button', style: 'secondary', action: { type: 'message', label: 'ยืม-คืน', text: 'การยืม-คืนครุภัณฑ์' } }
                                    ]
                                }
                            },
                            {
                                type: 'bubble',
                                body: {
                                    type: 'box', layout: 'vertical', contents: [
                                        { type: 'text', text: 'จัดการบัญชี', weight: 'bold', size: 'xl', color: '#0367D3' },
                                        { type: 'text', text: 'ข้อมูลส่วนตัวและการตั้งค่า', size: 'xs', color: '#aaaaaa', margin: 'sm' }
                                    ]
                                },
                                footer: {
                                    type: 'box', layout: 'vertical', spacing: 'sm', contents: [
                                        { type: 'button', style: 'secondary', action: { type: 'message', label: 'ข้อมูลผู้ใช้งาน', text: 'ข้อมูลผู้ใช้งาน' } },
                                        { type: 'button', style: 'secondary', action: { type: 'message', label: 'ลงทะเบียน', text: 'ลงทะเบียน' } },
                                        { type: 'button', style: 'secondary', action: { type: 'message', label: 'ตั้งค่าความปลอดภัย', text: 'ตั้งค่าความปลอดภัย' } }
                                    ]
                                }
                            }
                        ]
                    }
                }
            ]
        };

        await axios.post(LINE_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
};

export const replyRegistration = async ({
    replyToken,
    userId
}: ReplyRegistration) => {
    try {
        const profile = await getUserProfile(userId);
        const requestData = {
            replyToken,
            messages: [
                {
                    type: 'flex',
                    altText: 'ลงทะเบียน',
                    contents: {
                        type: 'bubble',
                        body: {
                            type: 'box', layout: 'vertical', contents: [
                                { type: 'text', text: 'ลงทะเบียน', weight: 'bold', color: '#0000FF', size: 'xl' },
                                { type: 'text', text: '🔒 ข้อมูลของคุณจะถูกเก็บรักษาเป็นความลับอย่างปลอดภัย', wrap: true, size: 'sm', margin: 'md' },
                                { type: 'text', text: `คุณ ${profile?.displayName || ''}`, size: 'sm', color: '#555555', wrap: true, margin: 'sm' }
                            ]
                        },
                        footer: { type: 'box', layout: 'vertical', contents: [ { type: 'button', style: 'primary', color: '#00C300', action: { type: 'uri', label: 'กดเพื่อลงทะเบียน', uri: `${WEB_API}/registration?auToken=${userId}` } } ] }
                    }
                }
            ]
        };
        await axios.post(LINE_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const replyNotRegistration = async ({
    replyToken,
    userId
}: ReplyRegistration) => {
    try {
        const profile = await getUserProfile(userId);
        const requestData = {
            replyToken,
            messages: [
                {
                    type: 'flex',
                    altText: 'ลงทะเบียน',
                    contents: {
                        type: 'bubble',
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                { type: 'text', text: 'ลงทะเบียน', weight: 'bold', color: '#0000FF', size: 'xl' },
                                { type: 'text', text: '🔒 ข้อมูลของคุณจะถูกเก็บรักษาเป็นความลับอย่างปลอดภัย', wrap: true, size: 'sm', margin: 'md' },
                                { type: 'text', text: `คุณ ${profile?.displayName || ''}`, size: 'sm', color: '#555555', wrap: true, margin: 'sm' }
                            ]
                        },
                        footer: { type: 'box', layout: 'vertical', contents: [ { type: 'button', style: 'primary', color: '#00C300', action: { type: 'uri', label: 'กดเพื่อลงทะเบียน', uri: `${WEB_API}/registration?auToken=${userId}` } } ] }
                    }
                }
            ]
        };
        await axios.post(LINE_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const replyMenuBorrowequipment = async ({ replyToken, userData }: ReplyUserData) => {
    try {
        const profile = await getUserProfile(userData.users_line_id);
        const requestData = {
            replyToken,
            messages: [
                {
                    type: 'flex',
                    altText: 'การยืม-คืนครุภัณฑ์',
                    contents: {
                        type: 'bubble',
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                { type: 'text', text: 'การยืม-คืนครุภัณฑ์', weight: 'bold', color: '#0000FF', size: 'xl' },
                                { type: 'text', text: `คุณ ${profile?.displayName || ''}`, size: 'sm', color: '#555555', margin: 'sm' },
                                { type: 'separator', margin: 'md' },
                                { type: 'text', text: 'เลือกตัวเลือกด้านล่างเพื่อดำเนินการ', size: 'sm', color: '#666666', margin: 'md' }
                            ]
                        },
                        footer: {
                            type: 'box', layout: 'vertical', spacing: 'sm', contents: [
                                { type: 'button', style: 'primary', color: '#0000FF', action: { type: 'uri', label: 'ยืมครุภัณฑ์', uri: `${WEB_API}/borrowequipment/borrow?auToken=${userData.users_line_id}` } },
                                { type: 'button', style: 'primary', color: '#0000FF', action: { type: 'uri', label: 'คืนครุภัณฑ์', uri: `${WEB_API}/borrowequipment/return_of?auToken=${userData.users_line_id}` } }
                            ]
                        }
                    }
                }
            ]
        };
        await axios.post(LINE_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) console.log('replyMenuBorrowequipment error:', error.message);
    }
}
export const replyConnection = async ({
    replyToken,
    userData,
    userTakecarepersonData
}: ReplyUserData) => {
    try {
        const profile = await getUserProfile(userData.users_line_id);
        const requestData = {
            replyToken,
            messages: [
    {
        type: 'flex',
        altText: 'การเชื่อมต่อนาฬิกา',
        contents: {
            type: 'bubble',
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    { 
                        type: 'text', 
                        text: 'การเชื่อมต่อนาฬิกา', 
                        weight: 'bold', 
                        color: '#0000FF', 
                        size: 'xl' 
                    },
                    { 
                        type: 'text', 
                        text: 'นำ ID และ PIN ที่คุณได้รับไปกรอกในแอปพลิเคชันบนนาฬิกา', 
                        wrap: true, 
                        size: 'sm', 
                        margin: 'md', 
                        color: '#666666' 
                    },
                    { 
                        type: 'box', 
                        layout: 'horizontal', 
                        margin: 'lg', 
                        contents: [ 
                            { type: 'text', text: 'ID', weight: 'bold', size: 'md', flex: 1 }, 
                            { type: 'text', text: String(userData.users_id || '-'), weight: 'bold', size: 'md', flex: 3 } 
                        ] 
                    },
                    { 
                        type: 'box', 
                        layout: 'horizontal', 
                        margin: 'sm', 
                        contents: [ 
                            { type: 'text', text: 'PIN', weight: 'bold', size: 'md', flex: 1 }, 
                            { type: 'text', text: String(userData.users_pin || '-'), weight: 'bold', size: 'md', flex: 3 } 
                        ] 
                    }
                ]
            },
                    }
                }
            ],
        };
        await axios.post(LINE_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}
export const replyLocation = async ({
    replyToken,
    userData,
    safezoneData,
    userTakecarepersonData,
    locationData
}: ReplyLocationData) => {
    try {
        // 1) พิกัด
        let latitude = Number(safezoneData.safez_latitude);
        let longitude = Number(safezoneData.safez_longitude);
        if (locationData) {
            latitude = Number(locationData.locat_latitude);
            longitude = Number(locationData.locat_longitude);
        }

        // 2) ดึงค่า Temp/HR "ล่าสุด" (ไม่แสดงเวลา/คำว่าล่าสุด)
        const userIdNum = Number(userData.users_id);
        const takecareIdNum = Number(userTakecarepersonData.takecare_id);

        const [lastTemp, lastHR] = await Promise.all([
            prisma.temperature_records.findFirst({
                where: { users_id: userIdNum, takecare_id: takecareIdNum },
                orderBy: { record_date: 'desc' },
                select: { temperature_value: true, status: true }
            }),
            prisma.heartrate_records.findFirst({
                where: { users_id: userIdNum, takecare_id: takecareIdNum },
                orderBy: { record_date: 'desc' },
                select: { bpm: true, status: true }
            })
        ]);

        const tempVal = lastTemp ? Number(lastTemp.temperature_value).toFixed(1) : '—';
        const hrVal = lastHR ? String(Number(lastHR.bpm)) : '—';

        const tempColor = lastTemp?.status === 1 ? '#E11D48' : '#0EA5E9'; // แดงถ้าผิดปกติ, ฟ้าเมื่อปกติ
        const hrColor = lastHR?.status === 1 ? '#E11D48' : '#10B981';   // แดงถ้าผิดปกติ, เขียวเมื่อปกติ

        const mapImageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=15&size=600x390&markers=color:red%7C${latitude},${longitude}&key=${process.env.GOOGLE_MAPS_API_KEY || ''}`;
        const requestData = {
            replyToken,
            messages: [
                {
                    type: 'location',
                    title: `ตำแหน่งปัจจุบันของผู้ที่มีภาวะพึ่งพิง ${userTakecarepersonData?.takecare_fname || ''} ${userTakecarepersonData?.takecare_sname || ''}`,
                    address: 'สถานที่ตั้งปัจจุบันของผู้ที่มีภาวะพึ่งพิง',
                    latitude,
                    longitude
                },
                {
                    type: 'flex',
                    altText: 'ตำแหน่งและข้อมูลสุขภาพ',
                    contents: {
                        type: 'bubble',
                        hero: { type: 'image', url: mapImageUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' },
                        body: {
                            type: 'box', layout: 'vertical', contents: [
                                { type: 'text', text: 'ตำแหน่งปัจจุบัน', weight: 'bold', color: '#0000FF', size: 'xl' },
                                { type: 'box', layout: 'horizontal', margin: 'md', contents: [ { type: 'text', text: 'ชื่อ-สกุล', size: 'sm', flex: 2, color: '#666666' }, { type: 'text', text: `${userTakecarepersonData?.takecare_fname || ''} ${userTakecarepersonData?.takecare_sname || ''}`, size: 'sm', flex: 3 } ] },
                                { type: 'box', layout: 'horizontal', contents: [ { type: 'text', text: 'Latitude', size: 'sm', flex: 2, color: '#666666' }, { type: 'text', text: `${latitude}`, size: 'sm', flex: 3 } ] },
                                { type: 'box', layout: 'horizontal', contents: [ { type: 'text', text: 'Longitude', size: 'sm', flex: 2, color: '#666666' }, { type: 'text', text: `${longitude}`, size: 'sm', flex: 3 } ] },
                                { type: 'box', layout: 'horizontal', margin: 'lg', spacing: 'sm', contents: [
                                    { type: 'box', layout: 'vertical', backgroundColor: '#F8F9FA', cornerRadius: 'md', paddingAll: 'md', alignItems: 'center', contents: [ { type: 'text', text: 'อุณหภูมิ', size: 'sm' }, { type: 'text', text: tempVal, size: 'xxl', weight: 'bold', color: '#00C300' }, { type: 'text', text: 'องศา', size: 'xs' } ] },
                                    { type: 'box', layout: 'vertical', backgroundColor: '#F8F9FA', cornerRadius: 'md', paddingAll: 'md', alignItems: 'center', contents: [ { type: 'text', text: 'ชีพจร', size: 'sm' }, { type: 'text', text: hrVal, size: 'xxl', weight: 'bold', color: '#00C300' }, { type: 'text', text: 'ครั้งต่อนาที', size: 'xs' } ] }
                                ] }
                            ]
                        },
                        footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [ { type: 'button', style: 'primary', color: '#00C300', action: userTakecarepersonData?.takecare_tel1 ? { type: 'uri', label: `โทร ${userTakecarepersonData.takecare_tel1}`, uri: `tel:${userTakecarepersonData.takecare_tel1}` } : { type: 'message', label: 'โทร', text: 'ไม่มีข้อมูลเบอร์โทรศัพท์ของผู้มีภาวะพึ่งพิง' } }, { type: 'button', style: 'primary', color: '#888888', action: { type: 'uri', label: 'ดูแผนที่จากระบบ', uri: `${WEB_API}/location?auToken=${userData.users_line_id}&idsafezone=${safezoneData?.safezone_id || ''}&idlocation=${locationData ? locationData.location_id : ''}` } } ] }
                    }
                }
            ]
        };

        await axios.post(LINE_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) console.log(error.message);
    }
};

export const replySetting = async ({
    replyToken,
    userData,
    userTakecarepersonData,
    safezoneData,
    temperatureSettingData,
    heartrateSettingData
}: ReplySettingData & { temperatureSettingData?: any }) => {
    try {
        // ค่า default
        let r1 = 0;
        let r2 = 0;
        let idsafezone = 0;
        let maxTemperature = 0;
        let idSetting = 0;
        let minBpm = 55;
        let minEnabled = true;
        let maxBpm = 120;
        let idSettingHR = 0;

        if (safezoneData) {
            r1 = safezoneData.safez_radiuslv1 || 0;
            r2 = safezoneData.safez_radiuslv2 || 0;
            idsafezone = safezoneData.safezone_id || 0;
        }

        if (temperatureSettingData) {
            maxTemperature = temperatureSettingData.max_temperature || 37;
            idSetting = temperatureSettingData.setting_id || 0;
        }
        if (heartrateSettingData) {
            minBpm = Number(heartrateSettingData.min_bpm ?? 55);
            minEnabled = heartrateSettingData.min_enable ?? true;
            maxBpm = Number(heartrateSettingData.max_bpm ?? 120);
            idSettingHR = heartrateSettingData.id || 0;
        }

        const requestData = {
    replyToken,
    messages: [
        {
            type: 'flex',
            altText: 'ตั้งค่าความปลอดภัย',
            contents: {
                type: 'bubble',
                body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        { 
                            type: 'text', 
                            text: 'ตั้งค่าความปลอดภัย', 
                            weight: 'bold', 
                            color: '#00B900', 
                            size: 'xl' 
                        },
                        { 
                            type: 'box', 
                            layout: 'horizontal', 
                            margin: 'lg', 
                            contents: [ 
                                { type: 'text', text: 'ชื่อ', size: 'sm', flex: 2, color: '#666666' }, 
                                { type: 'text', text: `${userTakecarepersonData?.takecare_fname || '-'} ${userTakecarepersonData?.takecare_sname || '-'}`, size: 'sm', flex: 3, weight: 'bold' } 
                            ] 
                        },
                        { 
                            type: 'box', 
                            layout: 'horizontal', 
                            contents: [ 
                                { type: 'text', text: 'เขตปลอดภัยที่ 1', size: 'sm', flex: 2, color: '#666666' }, 
                                { type: 'text', text: `${r1} เมตร`, size: 'sm', flex: 3 } 
                            ] 
                        },
                        { 
                            type: 'box', 
                            layout: 'horizontal', 
                            contents: [ 
                                { type: 'text', text: 'เขตปลอดภัยที่ 2', size: 'sm', flex: 2, color: '#666666' }, 
                                { type: 'text', text: `${r2} เมตร`, size: 'sm', flex: 3 } 
                            ] 
                        },
                        { 
                            type: 'box', 
                            layout: 'horizontal', 
                            contents: [ 
                                { type: 'text', text: 'อุณหภูมิ', size: 'sm', flex: 2, color: '#666666' }, 
                                { type: 'text', text: `${maxTemperature} °C`, size: 'sm', flex: 3 } 
                            ] 
                        },
                        { 
                            type: 'box', 
                            layout: 'horizontal', 
                            contents: [ 
                                { type: 'text', text: 'ชีพจร (สูงสุด)', size: 'sm', flex: 2, color: '#666666' }, 
                                { type: 'text', text: `${maxBpm} bpm`, size: 'sm', flex: 3 } 
                            ] 
                        },
                        { 
                            type: 'box', 
                            layout: 'horizontal', 
                            contents: [ 
                                { type: 'text', text: 'ชีพจร (ต่ำสุด)', size: 'sm', flex: 2, color: '#666666' }, 
                                { 
                                    type: 'text', 
                                    text: minEnabled !== false && minBpm ? `${minBpm} bpm` : 'ปิดใช้งาน', 
                                    size: 'sm', 
                                    flex: 3,
                                    color: minEnabled !== false && minBpm ? '#111111' : '#999999'
                                } 
                            ] 
                        }
                    ],
                },
                footer: {
                    type: 'box', 
                    layout: 'vertical', 
                    spacing: 'sm', 
                    contents: [
                        { 
                            type: 'button', 
                            style: 'primary', 
                            color: '#00B900', 
                            action: { 
                                type: 'uri', 
                                label: 'ตั้งค่าเขตปลอดภัย', 
                                uri: `${WEB_API}/setting?auToken=${userData.users_line_id}&idsafezone=${idsafezone}` 
                            } 
                        },
                        { 
                            type: 'button', 
                            style: 'primary', 
                            color: '#00B900', 
                            action: { 
                                type: 'uri', 
                                label: 'ตั้งค่าอุณหภูมิร่างกาย', 
                                uri: `${WEB_API}/settingTemp?auToken=${userData.users_line_id}&idsetting=${idSetting || ''}` 
                            } 
                        },
                        { 
                            type: 'button', 
                            style: 'primary', 
                            color: '#00B900', 
                            action: { 
                                type: 'uri', 
                                label: 'ตั้งค่าชีพจร', 
                                uri: `${WEB_API}/settingHeartRate?auToken=${userData.users_line_id}&idsetting=${idSettingHR || ''}` 
                            } 
                        }
                    ]
                }
            }
        }
    ]
};

        await axios.post(LINE_MESSAGING_API, requestData, { headers: LINE_HEADER });

    } catch (error) {
        if (error instanceof Error) {
            console.error("replySetting error:", error.message);
        }
    }
};
export const replyUserInfo = async ({
    replyToken,
    userData,
    userTakecarepersonData
}: ReplyUserData) => {
    try {
        const caregiverContents = [
            layoutBoxBaseline('ชื่อ-สกุล', `${userData.users_fname || '-'} ${userData.users_sname || '-'}`),
            layoutBoxBaseline('ที่อยู่', `${userData.users_number || '-'} หมู่ ${userData.users_moo || '-'}`),
            layoutBoxBaseline('ถนน', userData.users_road || '-'),
            layoutBoxBaseline('ตำบล', userData.users_tubon || '-'),
            layoutBoxBaseline('อำเภอ', userData.users_amphur || '-'),
            layoutBoxBaseline('จังหวัด', userData.users_province || '-'),
            layoutBoxBaseline('รหัสไปรษณีย์', userData.users_postcode || '-'),
            layoutBoxBaseline('เบอร์มือถือ', userData.users_tel1 || '-'),
            layoutBoxBaseline('เบอร์บ้าน', userData.users_tel_home || '-'),
        ];

        const dependentContents = userTakecarepersonData ? [
            layoutBoxBaseline('ชื่อ-สกุล', `${userTakecarepersonData.takecare_fname || '-'} ${userTakecarepersonData.takecare_sname || '-'}`),
            layoutBoxBaseline('วันเกิด', userTakecarepersonData.takecare_birthday ? moment(userTakecarepersonData.takecare_birthday).format('DD/MM/YYYY') : '-'),
            layoutBoxBaseline('ที่อยู่', `${userTakecarepersonData.takecare_number || '-'} หมู่ ${userTakecarepersonData.takecare_moo || '-'}`),
            layoutBoxBaseline('ถนน', userTakecarepersonData.takecare_road || '-'),
            layoutBoxBaseline('ตำบล', userTakecarepersonData.takecare_tubon || '-'),
            layoutBoxBaseline('อำเภอ', userTakecarepersonData.takecare_amphur || '-'),
            layoutBoxBaseline('จังหวัด', userTakecarepersonData.takecare_province || '-'),
            layoutBoxBaseline('รหัสไปรษณีย์', userTakecarepersonData.takecare_postcode || '-'),
            layoutBoxBaseline('เบอร์มือถือ', userTakecarepersonData.takecare_tel1 || '-'),
            layoutBoxBaseline('เบอร์บ้าน', userTakecarepersonData.takecare_tel_home || '-'),
            layoutBoxBaseline('โรคประจำตัว', userTakecarepersonData.takecare_disease || '-'),
            layoutBoxBaseline('ยาที่ใช้ประจำ', userTakecarepersonData.takecare_drug || '-'),
        ] : [
            layoutBoxBaseline('ข้อมูล', 'ยังไม่ได้เพิ่มข้อมูลผู้มีภาวะพึ่งพิง')
        ];

        const requestData = {
            replyToken,
            messages: [
                {
                    type: 'flex',
                    altText: 'ข้อมูลผู้ใช้งาน',
                    contents: {
                        type: 'bubble',
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                { type: 'text', text: 'ข้อมูลผู้ใช้งาน', weight: 'bold', color: '#0000FF', size: 'xl' },
                                { type: 'text', text: 'ข้อมูลผู้ดูแล', size: 'md', margin: 'md', color: '#666666' },
                                { type: 'box', layout: 'vertical', margin: 'sm', spacing: 'sm', contents: caregiverContents },
                                { type: 'separator', margin: 'md' },
                                { type: 'text', text: 'ข้อมูลผู้มีภาวะพึ่งพิง', size: 'md', margin: 'md', color: '#666666' },
                                { type: 'box', layout: 'vertical', margin: 'sm', spacing: 'sm', contents: dependentContents }
                            ]
                        },
                        footer: {
                            type: 'box', layout: 'vertical', spacing: 'sm', contents: [
                                { type: 'button', style: 'primary', color: '#0000CC', action: { type: 'uri', label: 'ตั้งค่าข้อมูลผู้ดูแล', uri: `${WEB_API}/userinfo/cuserinfo?auToken=${userData.users_line_id}` } },
                                { type: 'button', style: 'primary', color: '#00C300', action: { type: 'uri', label: 'ตั้งค่าข้อมูลผู้มีภาวะพึ่งพิง', uri: userTakecarepersonData ? `${WEB_API}/userinfo/puserinfo?auToken=${userData.users_line_id}` : `${WEB_API}/elderly_registration?auToken=${userData.users_line_id}` } }
                            ]
                        }
                    }
                }
            ]
        };

        await axios.post(LINE_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const replyUserData = async ({
    replyToken,
    userData
}: ReplyUserData) => {

    try {
        const profile = await getUserProfile(userData.users_line_id);
        const requestData = {
            replyToken,
            messages: [
                {
                    type: 'flex',
                    altText: 'ข้อมูลลงทะเบียน',
                    contents: {
                        type: 'bubble',
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                { type: 'text', text: 'ข้อมูลลงทะเบียน', weight: 'bold', color: '#0000FF', size: 'xl' },
                                { type: 'text', text: `คุณ ${profile?.displayName || ''}`, size: 'sm', color: '#555555', margin: 'sm' },
                                { type: 'separator', margin: 'md' },
                                { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: [
                                    layoutBoxBaseline('ชื่อ', `${userData.users_fname} ${userData.users_sname}`),
                                    layoutBoxBaseline('Pin', String(userData.users_pin || '-')),
                                    layoutBoxBaseline('สถานะ', userData.users_status_id?.status_name || '-'),
                                    layoutBoxBaseline('ที่อยู่', `${userData.users_number || '-'} หมู่ ${userData.users_moo || '-'}`),
                                    layoutBoxBaseline('ตำบล', `${userData.users_tubon || '-'}`),
                                    layoutBoxBaseline('อำเภอ', `${userData.users_amphur || '-'}`),
                                    layoutBoxBaseline('จังหวัด', `${userData.users_province || '-'}`),
                                    layoutBoxBaseline('รหัสไปรษณีย์', `${userData.users_postcode || '-'}`),
                                    layoutBoxBaseline('เบอร์มือถือ', `${userData.users_tel1 || '-'}`),
                                ] },
                            ]
                        },
                        footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [ { type: 'button', style: 'primary', color: '#00C300', action: { type: 'uri', label: 'ลงทะเบียนผู้มีภาวะพึ่งพิง', uri: `${WEB_API}/elderly_registration?auToken=${userData.users_line_id}` } } ] }
                    }
                }
            ]
        };
        await axios.post(LINE_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const replyNotification = async ({
    replyToken,
    message
}: ReplyNotification) => {
    try {
        const requestData = {
            to: replyToken,
            messages: [
                {
                    type: "flex",
                    altText: "แจ้งเตือน",
                    contents: {
                        type: "bubble",
                        body: {
                            type: "box",
                            layout: "vertical",
                            contents: [
                                {
                                    type: "text",
                                    text: " ",
                                    contents: [
                                        {
                                            type: "span",
                                            text: "สถานะเคส",
                                            color: "#1976D2",
                                            size: "xl",
                                            weight: "bold",
                                            decoration: "none"
                                        },
                                        {
                                            type: "span",
                                            text: " ",
                                            size: "xxl",
                                            decoration: "none"
                                        }
                                    ]
                                },
                                {
                                    type: "separator",
                                    margin: "md"
                                },
                                {
                                    type: "text",
                                    text: " ",
                                    wrap: true,
                                    lineSpacing: "5px",
                                    margin: "md",
                                    contents: [
                                        {
                                            type: "span",
                                            text: message,
                                            color: "#555555",
                                            size: "md",
                                            // decoration: "none",
                                            // wrap      : true
                                        },
                                        {
                                            type: "span",
                                            text: " ",
                                            size: "xl",
                                            decoration: "none"
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }
            ],
        };
        await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const replyNotificationPostback = async ({
    userId,
    takecarepersonId,
    type,
    message,
    replyToken,

}: ReplyNotificationPostback) => {
    try {
         // ดึงพิกัดล่าสุดของผู้ที่มีภาวะพึ่งพิง (ถ้ามี) และแนบเป็นข้อความประเภท location
        let preMessages: any[] = [];
        try {
            const takecareLoc = await prisma.location.findFirst({
                where: { takecare_id: Number(takecarepersonId) },
                orderBy: { locat_timestamp: 'desc' }
            });

            if (takecareLoc) {
                preMessages.push({
                    type: 'location',
                    title: `ตำแหน่งผู้ที่มีภาวะพึ่งพิง`,
                    address: `ตำแหน่งล่าสุด`,
                    latitude: Number(takecareLoc.locat_latitude),
                    longitude: Number(takecareLoc.locat_longitude),
                });
            }
        } catch (err) {
            console.log('Could not fetch takecare latest location:', err);
        }
        const requestData = {
            to: replyToken,
            messages: [
                ...preMessages,
                {
                    type: "flex",
                    altText: "แจ้งเตือน",
                    contents: {
                        type: "bubble",
                        body: {
                            type: "box",
                            layout: "vertical",
                            contents: [
                                {
                                    type: "text",
                                    text: " ",
                                    contents: [
                                        {
                                            type: "span",
                                            text: "สถานะเคส",
                                            color: "#1976D2",
                                            size: "xl",
                                            weight: "bold",
                                            decoration: "none"
                                        },
                                        {
                                            type: "span",
                                            text: " ",
                                            size: "xxl",
                                            decoration: "none"
                                        }
                                    ]
                                },
                                {
                                    type: "separator",
                                    margin: "md"
                                },
                                {
                                    type: "text",
                                    text: " ",
                                    wrap: true,
                                    lineSpacing: "5px",
                                    margin: "md",
                                    contents: [
                                        {
                                            type: "span",
                                            text: message,
                                            color: "#555555",
                                            size: "md",
                                            // decoration: "none",
                                            // wrap      : true
                                        },
                                        {
                                            type: "span",
                                            text: " ",
                                            size: "xl",
                                            decoration: "none"
                                        }
                                    ]
                                },
                                {
                                    type: "button",
                                    style: "primary",
                                    height: "sm",
                                    margin: "xxl",
                                    action: {
                                        type: "postback",
                                        label: "ส่งขอความช่วยเหลือเพิ่มเติม",
                                        data: `userLineId=${replyToken}&takecarepersonId=${takecarepersonId}&type=${type}`,
                                    }
                                },
                                
                                {
                                    type: "text",
                                    text: " ",
                                    wrap: true,
                                    lineSpacing: "5px",
                                    margin: "md",
                                    contents: [
                                        {
                                            type: "span",
                                            text: "*หมาย: ข้าพเจ้ายินยอมเปิดเผยข้อมูลตำแหน่งปัจจุบันของผู้ที่มีภาวะพึ่งพิง",
                                            color: "#ff0000",
                                            size: "sm",
                                            // decoration: "none",
                                            // wrap      : true
                                        },
                                        {
                                            type: "span",
                                            text: " ",
                                            size: "xl",
                                            decoration: "none"
                                        }
                                    ]
                                },
                            ]
                        }
                    }
                }
            ],
        };
        await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const replyNotificationSOS = async ({
    replyToken,
    message
}: ReplyNotification) => {
    try {
        const contents = getRedAlertTemplate({
            title: 'แจ้งเตือนฉุกเฉิน',
            message,
        });

        const requestData = {
            to: replyToken,
            messages: [
                {
                    type: "flex",
                    altText: "แจ้งเตือน",
                    contents
                }
            ],
        };
        await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const replyNotificationSendDocQuery = async ({
    replyToken,
    userData
}: {
    replyToken: string;
    userData: any;
}) => {
    try {

        const requestData = {
            to: replyToken,
            messages: [
                {
                    type: "flex",
                    altText: "แจ้งเตือน",
                    contents: {
                        type: "bubble",
                        body: {
                            type: "box",
                            layout: "vertical",
                            contents: [
                                {
                                    type: "text",
                                    text: " ",
                                    contents: [
                                        {
                                            type: "span",
                                            text: "แบบสอบถาม",
                                            color: "#FC0303",
                                            size: "xl",
                                            weight: "bold",
                                            decoration: "none"
                                        },
                                        {
                                            type: "span",
                                            text: " ",
                                            size: "xxl",
                                            decoration: "none"
                                        }
                                    ]
                                },
                                {
                                    type: "separator",
                                    margin: "md"
                                },
                                {
                                    type: "text",
                                    text: " ",
                                    wrap: true,
                                    lineSpacing: "5px",
                                    margin: "md",
                                    contents: [
                                        {
                                            type: "span",
                                            text: "กรุณาตอบแบบสอบถามเพื่อให้ข้อมูลที่ถูกต้อง",
                                            color: "#555555",
                                            size: "md",
                                            // decoration: "none",
                                            // wrap      : true
                                        },

                                        {
                                            type: "span",
                                            text: " ",
                                            size: "xl",
                                            decoration: "none"
                                        }
                                    ]
                                },
                                {
                                    type: "button",
                                    style: "primary",
                                    height: "sm",
                                    margin: "xxl",
                                    action: {
                                        type: "uri",
                                        label: "ตอบแบบสอบถาม",
                                        uri: `${WEB_API}/questionnaire?id=${userData.borrow_id}`
                                    }
                                },
                            ]
                        }
                    }
                }
            ],
        };
        await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}
export const replyNotificationPostbackTemp = async ({
    userId,
    takecarepersonId,
    type,
    message,
    replyToken,

}: ReplyNotificationPostbackTemp) => {
    try {
        const contents = getRedAlertTemplate({
            title: 'แจ้งอุณหภูมิร่างกายสูง',
            message,
            postbackData: `userLineId=${replyToken}&takecarepersonId=${takecarepersonId}&type=${type}`,
            showConsentNote: true,
        });

        const requestData = {
            to: replyToken,
            messages: [
                {
                    type: "flex",
                    altText: "แจ้งเตือน",
                    contents
                }
            ],
        };
        await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}
export const replyNotificationPostbackfall = async ({
    userId,
    takecarepersonId,
    type,
    message,
    replyToken,

}: ReplyNotificationPostbackfall) => {
    try {
        const contents = getRedAlertTemplate({
            title: 'แจ้งเตือนการล้ม',
            message,
            postbackData: `userLineId=${replyToken}&takecarepersonId=${takecarepersonId}&type=${type}`,
            showConsentNote: true,
        });

        const requestData = {
            to: replyToken,
            messages: [
                {
                    type: "flex",
                    altText: "แจ้งเตือน",
                    contents
                }
            ],
        };
        await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const replyNotificationPostbackHeart = async ({
    userId,
    takecarepersonId,
    type,
    message,
    replyToken,

}: ReplyNotificationPostbackHeart) => {
    try {
        const contents = getRedAlertTemplate({
            title: 'แจ้งเตือนชีพจร',
            message,
            postbackData: `userLineId=${replyToken}&takecarepersonId=${takecarepersonId}&type=${type}`,
            showConsentNote: true,
        });

        const requestData = {
            to: replyToken,
            messages: [
                {
                    type: "flex",
                    altText: "แจ้งเตือน",
                    contents
                }
            ],
        };
        await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}

export const pushFlexMessage = async ({
    replyToken,
    altText,
    contents
}: ReplyFlexMessage) => {
    try {
        const requestData = {
            to: replyToken,
            messages: [
                {
                    type: 'flex',
                    altText,
                    contents,
                },
            ],
        };

        const response = await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
        return response.data;
    } catch (error) {
        if (error instanceof Error) {
            console.log(error.message);
        }
    }
}
