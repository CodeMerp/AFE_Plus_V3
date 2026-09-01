import axios from 'axios';
import moment from 'moment';
import prisma from '@/lib/prisma'

const WEB_API = process.env.WEB_API_URL;
const LINE_INFO_API = 'https://api.line.me/v2/bot/info';
const LINE_GROUP_API = 'https://api.line.me/v2/bot/group/'
const LINE_PUSH_MESSAGING_API = 'https://api.line.me/v2/bot/message/push';
const LINE_PROFILE_API = 'https://api.line.me/v2/bot/profile';
const LINE_HEADER = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CHANNEL_ACCESS_TOKEN_LINE}`,
};

interface ReplyNotification {
    resUser: {
        users_related_borrow: string;
        users_fname: string;
        users_sname: string;
        users_tel1: string;
        users_line_id: string;
    };
    resTakecareperson: {
        takecare_fname: string;
        takecare_sname: string;
        takecare_tel1: string;
        takecare_id: number;
    };
    resSafezone: any;
    extendedHelpId: number;
    locationData: {
        locat_latitude: string;
        locat_longitude: string;
    };
}

interface ReplyNoti {
    replyToken: string;
    message: string;
    userIdAccept: string;
    title?: string;
    titleColor?: string;
    buttons?: ReplyNotiButton[];
    buttonRows?: ReplyNotiButton[][];
    detailRows?: ReplyNotiDetailRow[];
}

interface ReplyNotiButton {
    label: string;
    type: "postback" | "uri" | "message";
    data?: string;
    uri?: string;
    text?: string;
}

interface ReplyNotiDetailRow {
    label: string;
    value: string;
}

interface ReplySafezoneBackMessage {
    resUser: {
        users_fname: string;
        users_sname: string;
        users_tel1: string;
        users_line_id: string;
    };
    resTakecareperson: {
        takecare_fname: string;
        takecare_sname: string;
        takecare_tel1: string;
        takecare_id: number;
    };
    extenId: number;
}

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

const layoutBoxBaseline = (label: string, text: string, flex1 = 2, flex2 = 5) => {
    return {
        type: "box",
        layout: "baseline",
        contents: [
            {
                type: "text",
                text: label || "ไม่ระบุ",
                flex: flex1,
                size: "sm",
                color: "#AAAAAA"
            },
            {
                type: "text",
                text: text || "-",
                flex: flex2,
                size: "sm",
                color: "#666666",
                wrap: true
            }
        ]
    }
}

const header1 = (title = "แจ้งเตือนช่วยเหลือเพิ่มเติม") => {
    const h1 = {
        type: "text",
        text: title,
        contents: [
            {
                type: "span",
                text: title,
                color: "#FC0303",
                size: "xl",
                weight: "bold",
                decoration: "none"
            }
        ]
    }
    const h2 = {
        type: "separator",
        margin: "md"
    }
    return [h1, h2]
}

export const replyNotification = async ({
    resUser,
    resTakecareperson,
    resSafezone,
    extendedHelpId,
    locationData,
}: ReplyNotification) => {
    try {
        const latitude = Number(locationData.locat_latitude);
        const longitude = Number(locationData.locat_longitude);

        // ค้นหากลุ่มที่เปิดใช้งานจากฐานข้อมูล
        const groupLine = await prisma.groupLine.findFirst({
            where: {
                group_status: 1,
            },
        });

        if (groupLine) {
            const groupLineId = groupLine.group_line_id;

            // ตรวจสอบและทำความสะอาดข้อมูลก่อนส่ง
            const userFullName = `${resUser.users_fname || ''} ${resUser.users_sname || ''}`.trim() || 'ไม่ระบุชื่อ';
            const userTel = resUser.users_tel1 || '-';
            const takecareFullName = `${resTakecareperson.takecare_fname || ''} ${resTakecareperson.takecare_sname || ''}`.trim() || 'ไม่ระบุชื่อ';
            const takecareTel = resTakecareperson.takecare_tel1 || '-';

            const requestData = {
                to: groupLineId,
                messages: [
                    {
                        type: 'location',
                        title: `ตำแหน่งปัจจุบันของผู้มีภาวะพึ่งพิง ${takecareFullName}`,
                        address: 'สถานที่ตั้งปัจจุบันของผู้มีภาวะพึ่งพิง',
                        latitude: latitude,
                        longitude: longitude,
                    },
                    {
                        type: 'flex',
                        altText: 'แจ้งเตือน',
                        contents: {
                            type: 'bubble',
                            body: {
                                type: 'box',
                                layout: 'vertical',
                                contents: [
                                    header1()[0],
                                    header1()[1],
                                    {
                                        type: 'text',
                                        text: 'ข้อมูลผู้ดูแล',
                                        size: 'md',
                                        color: '#555555',
                                        wrap: true,
                                        margin: 'sm',
                                    },
                                    {
                                        type: 'box',
                                        layout: 'vertical',
                                        margin: 'xxl',
                                        spacing: 'sm',
                                        contents: [
                                            layoutBoxBaseline('ชื่อ-สกุล', userFullName, 4, 5),
                                            layoutBoxBaseline('เบอร์โทร', userTel, 4, 5),
                                        ],
                                    },
                                    {
                                        type: 'separator',
                                        margin: 'xxl',
                                    },
                                    {
                                        type: 'text',
                                        text: 'ข้อมูลผู้มีภาวะพึ่งพิง',
                                        size: 'md',
                                        color: '#555555',
                                        wrap: true,
                                        margin: 'sm',
                                    },
                                    {
                                        type: 'box',
                                        layout: 'vertical',
                                        margin: 'xxl',
                                        spacing: 'sm',
                                        contents: [
                                            layoutBoxBaseline('ชื่อ-สกุล', takecareFullName, 4, 5),
                                            layoutBoxBaseline('เบอร์โทร', takecareTel, 4, 5),
                                        ],
                                    },
                                    {
                                        type: 'button',
                                        style: 'primary',
                                        height: 'sm',
                                        margin: 'xxl',
                                        color: '#888888',
                                        action: {
                                            type: 'uri',
                                            label: 'ดูแผนที่จากระบบ',
                                            uri: `${WEB_API}/location?auToken=${resUser.users_line_id}&idsafezone=${resSafezone?.safezone_id || ''}&idlocation=${extendedHelpId || ''}`
                                        }
                                    },
                                    {
                                        type: 'button',
                                        style: 'primary',
                                        color: '#777777',
                                        height: 'sm',
                                        margin: 'xxl',
                                        action: {
                                            type: 'postback',
                                            label: 'รับเคสช่วยเหลือ',
                                            data: `type=accept&takecareId=${resTakecareperson.takecare_id}&extenId=${extendedHelpId}&userLineId=${resUser.users_line_id}`,
                                        },
                                    },
                                    {
                                        type: 'button',
                                        style: 'primary',
                                        height: 'sm',
                                        margin: 'xxl',
                                        color: '#f10000',
                                        action: {
                                            type: 'uri',
                                            label: 'โทรหาผู้ดูแล',
                                            uri: `tel:${resUser.users_tel1 || '0000000000'}`
                                        },
                                    },
                                    {
                                        type: 'button',
                                        style: 'primary',
                                        height: 'sm',
                                        margin: 'xxl',
                                        color: '#f10000',
                                        action: resTakecareperson.takecare_tel1
                                            ? {
                                                type: 'uri',
                                                label: 'โทรหาผู้มีภาวะพึ่งพิง',
                                                uri: `tel:${resTakecareperson.takecare_tel1}`
                                            }
                                            : {
                                                type: 'message',
                                                label: 'โทรหาผู้มีภาวะพึ่งพิง',
                                                text: 'ไม่มีข้อมูลเบอร์โทรศัพท์ของผู้มีภาวะพึ่งพิง'
                                            }
                                    }
                                ],
                            },
                        },
                    },
                ],
            };

            // ส่งข้อความไปยังกลุ่ม
            await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
            console.log('✅ Notification sent successfully to group:', groupLineId);
        } else {
            console.log('❌ ไม่พบกลุ่มไลน์ที่ต้องการส่งข้อความไป');
        }
    } catch (error: any) {
        console.log("❌ LINE ERROR", error?.response?.status, error?.response?.data, error?.message);
        throw error;
    }
};

export const replyNoti = async ({
    replyToken,
    userIdAccept,
    message,
    title,
    titleColor,
    buttons = [],
    buttonRows = [],
    detailRows = [],
}: ReplyNoti) => {
    try {
        const profile = await getUserProfile(userIdAccept);
        const displayName = profile?.displayName || 'ผู้ใช้งาน';
        const messageText = message || 'ไม่มีข้อความ';
        const mapButtonAction = (b: ReplyNotiButton) =>
            b.type === "postback"
                ? { type: "postback", label: b.label, data: b.data || "" }
                : b.type === "uri"
                    ? { type: "uri", label: b.label, uri: b.uri || "" }
                    : { type: "message", label: b.label, text: b.text || "" };


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
                                    text: title || "แจ้งเตือนช่วยเหลือเพิ่มเติม",
                                    contents: [
                                        {
                                            type: "span",
                                            text: title || "แจ้งเตือนช่วยเหลือเพิ่มเติม",
                                            color: titleColor || "#FC0303",
                                            size: "xl",
                                            weight: "bold",
                                            decoration: "none",
                                        }
                                    ]
                                },
                                {
                                    type: "separator",
                                    margin: "md"
                                },
                                {
                                    type: "text",
                                    text: detailRows.length ? messageText : `คุณ ${displayName}`,
                                    wrap: true,
                                    margin: "md",
                                    color: "#555555",
                                    size: "md"
                                },
                                ...(detailRows.length
                                    ? [{
                                        type: "box",
                                        layout: "vertical",
                                        margin: "md",
                                        spacing: "sm",
                                        contents: detailRows.map((row) => ({
                                            type: "box",
                                            layout: "baseline",
                                            contents: [
                                                {
                                                    type: "text",
                                                    text: row.label,
                                                    color: "#AAAAAA",
                                                    size: "sm",
                                                    flex: 3,
                                                    wrap: true,
                                                },
                                                {
                                                    type: "text",
                                                    text: row.value || "-",
                                                    color: "#111111",
                                                    size: "sm",
                                                    flex: 5,
                                                    wrap: true,
                                                    weight: "bold",
                                                },
                                            ],
                                        })),
                                    }]
                                    : [{
                                        type: "text",
                                        text: messageText,
                                        wrap: true,
                                        margin: "md",
                                        color: "#555555",
                                        size: "md"
                                    }]
                                ),
                                ...buttons.map((b) => ({
                                    type: "button",
                                    style: "primary",
                                    color: '#777777',
                                    height: "sm",
                                    margin: "md",
                                    action: mapButtonAction(b),
                                })),
                                ...buttonRows.map((row) => ({
                                    type: "box",
                                    layout: "horizontal",
                                    margin: "md",
                                    spacing: "sm",
                                    contents: row.slice(0, 2).map((b) => ({
                                        type: "button",
                                        flex: 1,
                                        style: "primary",
                                        color: "#777777",
                                        height: "sm",
                                        action: mapButtonAction(b),
                                    })),
                                })),
                            ]
                        }
                    }
                }
            ],
        };

        await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
        console.log('✅ Reply notification sent successfully to:', replyToken);
    } catch (error: any) {
        console.log("❌ REPLY NOTI ERROR", error?.response?.status, error?.response?.data, error?.message);
        throw error;
    }
}

export const replySafezoneBackMessage = async ({
    resUser,
    resTakecareperson,
    extenId,
}: ReplySafezoneBackMessage) => {
    try {
        // ค้นหากลุ่มที่เปิดใช้งานจากฐานข้อมูล
        const groupLine = await prisma.groupLine.findFirst({
            where: {
                group_status: 1,
            },
        });

        if (groupLine) {
            const groupLineId = groupLine.group_line_id;

            // ตรวจสอบและทำความสะอาดข้อมูล
            const userFullName = `${resUser.users_fname || ''} ${resUser.users_sname || ''}`.trim() || 'ไม่ระบุชื่อ';
            const userTel = resUser.users_tel1 || '0000000000';
            const takecareFullName = `${resTakecareperson.takecare_fname || ''} ${resTakecareperson.takecare_sname || ''}`.trim() || 'ไม่ระบุชื่อ';
            const takecareTel = resTakecareperson.takecare_tel1 || '-';
            const liffAcceptCallUrl = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}` +
                `?extenId=${encodeURIComponent(String(extenId))}` +
                `&takecareId=${encodeURIComponent(String(resTakecareperson.takecare_id))}` +
                `&userLineId=${encodeURIComponent(resUser.users_line_id)}` +
                `&groupId=${encodeURIComponent(groupLineId)}` +
                `&tel=${encodeURIComponent(userTel)}`;

            const requestData = {
                to: groupLineId,
                messages: [
                    {
                        type: 'flex',
                        altText: 'แจ้งเตือนกลับเข้าเขต',
                        contents: {
                            type: 'bubble',
                            body: {
                                type: 'box',
                                layout: 'vertical',
                                contents: [
                                    {
                                        type: 'text',
                                        text: 'แจ้งเตือนกลับเข้าเขต',
                                        contents: [
                                            {
                                                type: 'span',
                                                text: 'แจ้งเตือนกลับเข้าเขต',
                                                color: '#000000',
                                                size: 'xl',
                                                weight: 'bold',
                                                decoration: 'none'
                                            }
                                        ],
                                        align: 'center'
                                    },
                                    {
                                        type: 'separator',
                                        margin: 'md'
                                    },
                                    {
                                        type: 'text',
                                        text: 'ข้อมูลผู้มีภาวะพึ่งพิง',
                                        size: 'md',
                                        color: '#555555',
                                        wrap: true,
                                        margin: 'sm',
                                    },
                                    {
                                        type: 'box',
                                        layout: 'vertical',
                                        margin: 'md',
                                        spacing: 'sm',
                                        contents: [
                                            layoutBoxBaseline('ชื่อ-สกุล', takecareFullName, 4, 5),
                                            layoutBoxBaseline('เบอร์โทร', takecareTel, 4, 5),
                                        ],
                                    },
                                    {
                                        type: 'separator',
                                        margin: 'md'
                                    },
                                    {
                                        type: 'text',
                                        text: 'ผู้มีภาวะพึ่งพิงได้กลับเข้าเขตปลอดภัยแล้ว',
                                        size: 'xl',
                                        color: '#2CD435',
                                        weight: 'bold',
                                        wrap: true,
                                        margin: 'xl',
                                        align: 'center'
                                    },
                                    {
                                        type: 'separator',
                                        margin: 'md'
                                    },
                                    {
                                        type: 'text',
                                        text: '*กรุณาโทรตรวจสอบกับผู้ดูแล',
                                        size: 'xs',
                                        color: '#555555',
                                        wrap: true,
                                        margin: 'md',
                                    },
                                    {
                                        type: 'button',
                                        style: 'primary',
                                        height: 'sm',
                                        margin: 'lg',
                                        color: '#ff0000',
                                        action: {
                                            type: 'uri',
                                            label: 'โทรหาผู้ดูแล',
                                            uri: liffAcceptCallUrl
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            };

            // ส่งข้อความไปยังกลุ่ม
            await axios.post(LINE_PUSH_MESSAGING_API, requestData, { headers: LINE_HEADER });
            console.log('✅ Safezone back message sent successfully to group:', groupLineId);
        } else {
            console.log('❌ ไม่พบกลุ่มไลน์ที่ต้องการส่งข้อความไป');
        }
    } catch (error: any) {
        console.log("❌ SAFEZONE BACK MESSAGE ERROR", error?.response?.status, error?.response?.data, error?.message);
        throw error;
    }
}