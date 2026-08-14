import { encrypt, parseQueryString } from "@/utils/helpers";
import * as api from "@/lib/listAPI";
import axios from "axios";
import prisma from "@/lib/prisma";

import { replyNotification, replyNoti } from "@/utils/apiLineGroup";

interface PostbackSafezoneProps {
    userLineId: string;
    takecarepersonId: number;
}

const getCurrentLocationStatus = async (
    takecare_id: number,
    users_id: number
) => {
    const latestLocation = await prisma.location.findFirst({
        where: {
            users_id: Number(users_id),
            takecare_id: Number(takecare_id),
        },
        orderBy: {
            locat_timestamp: 'desc',
        },
    });

    return latestLocation ? Number(latestLocation.locat_status) : null;
};

const getActiveExtendedHelp = async (takecareId: number, usersId: number) => {
    return prisma.extendedhelp.findFirst({
        where: {
            takecare_id: Number(takecareId),
            user_id: Number(usersId),
            exted_closed_date: null,
        },
        orderBy: { exten_date: "desc" },
    });
};

const getLocation = async (
    takecare_id: number,
    users_id: number,
    safezone_id: number
) => {
    const response = await axios.get(
        `${process.env.WEB_DOMAIN}/api/location/getLocation?takecare_id=${takecare_id}&users_id=${users_id}&safezone_id=${safezone_id}`
    );
    if (response.data?.data) {
        return response.data.data;
    } else {
        return null;
    }
};

export const postbackHeartRate = async ({
    userLineId,
    takecarepersonId,
}: PostbackSafezoneProps) => {
    try {
        const resUser = await api.getUser(userLineId);
        const resTakecareperson = await api.getTakecareperson(
            takecarepersonId.toString(),
            resUser?.users_id
        );

        if (resUser && resTakecareperson) {
            const resSafezone = await api.getSafezone(
                resTakecareperson.takecare_id,
                resUser.users_id
            );
            if (resSafezone) {
                const resExtendedHelp = await getActiveExtendedHelp(
                    resTakecareperson.takecare_id,
                    resUser.users_id
                );

                // เช็คว่ามีเคสที่ยังไม่ปิดอยู่ → ส่งซ้ำไม่ได้
                if (
                    resExtendedHelp &&
                    !resExtendedHelp.exted_closed_date
                ) {
                    console.log(
                        `Heart rate case still open. exten_id: ${resExtendedHelp.exten_id}`
                    );
                    return "already_sent";
                }

                // ไม่มีเคส หรือเคสเดิมปิดแล้ว → สร้างใหม่
                let extendedHelpId = null;
                const data = {
                    takecareId: resTakecareperson.takecare_id,
                    usersId: resUser.users_id,
                    typeStatus: "save",
                    safezLatitude: resSafezone.safez_latitude,
                    safezLongitude: resSafezone.safez_longitude,
                };
                const resNewId = await api.saveExtendedHelp(data);
                extendedHelpId = resNewId;

                const responseLocation = await getLocation(
                    resTakecareperson.takecare_id,
                    resUser.users_id,
                    resSafezone.safezone_id
                );

                // ส่งการแจ้งเตือนกลับ
                await replyNotification({
                    resUser,
                    resTakecareperson,
                    resSafezone,
                    extendedHelpId,
                    locationData: responseLocation,
                });

                return resUser.users_line_id;
            } else {
                console.log(
                    `NO SAFEZONE FOUND for takecare_id: ${resTakecareperson.takecare_id}, users_id: ${resUser.users_id}`
                );
            }
        } else {
            console.log(
                `USER or TAKECAREPERSON NOT FOUND. userLineId: ${userLineId}, takecarepersonId: ${takecarepersonId}`
            );
        }

        return null;
    } catch (error) {
        console.log(" ~ postbackHeartRate ~ error:", error);
        return null;
    }
};

export const postbackFall = async ({
    userLineId,
    takecarepersonId,
}: PostbackSafezoneProps) => {
    try {
        const resUser = await api.getUser(userLineId);
        const resTakecareperson = await api.getTakecareperson(
            takecarepersonId.toString(),
            resUser?.users_id
        );

        if (resUser && resTakecareperson) {
            const resSafezone = await api.getSafezone(
                resTakecareperson.takecare_id,
                resUser.users_id
            );
            if (resSafezone) {
                const resExtendedHelp = await getActiveExtendedHelp(
                    resTakecareperson.takecare_id,
                    resUser.users_id
                );

                // เช็คว่ามีเคสที่ยังไม่ปิดอยู่ → ส่งซ้ำไม่ได้
                if (
                    resExtendedHelp &&
                    !resExtendedHelp.exted_closed_date
                ) {
                    console.log(
                        `Fall case still open. exten_id: ${resExtendedHelp.exten_id}`
                    );
                    return "already_sent";
                }

                // ไม่มีเคส หรือเคสเดิมปิดแล้ว → สร้างใหม่
                let extendedHelpId = null;
                const data = {
                    takecareId: resTakecareperson.takecare_id,
                    usersId: resUser.users_id,
                    typeStatus: "save",
                    safezLatitude: resSafezone.safez_latitude,
                    safezLongitude: resSafezone.safez_longitude,
                };
                const resNewId = await api.saveExtendedHelp(data);
                extendedHelpId = resNewId;

                const responseLocation = await getLocation(
                    resTakecareperson.takecare_id,
                    resUser.users_id,
                    resSafezone.safezone_id
                );

                // ส่งการแจ้งเตือนกลับ
                await replyNotification({
                    resUser,
                    resTakecareperson,
                    resSafezone,
                    extendedHelpId,
                    locationData: responseLocation,
                });

                // ส่ง Line ID กลับเป็นตัวบ่งชี้ว่า success
                return resUser.users_line_id;
            } else {
                console.log(
                    `NO SAFEZONE FOUND for takecare_id: ${resTakecareperson.takecare_id}, users_id: ${resUser.users_id}`
                );
            }
        } else {
            console.log(
                `USER or TAKECAREPERSON NOT FOUND. userLineId: ${userLineId}, takecarepersonId: ${takecarepersonId}`
            );
        }

        return null;
    } catch (error) {
        console.log(" ~ postbackFall ~ error:", error);
        return null;
    }
};

export const postbackTemp = async ({
    userLineId,
    takecarepersonId,
}: PostbackSafezoneProps) => {
    try {
        const resUser = await api.getUser(userLineId);
        const resTakecareperson = await api.getTakecareperson(
            takecarepersonId.toString(),
            resUser?.users_id
        );

        if (resUser && resTakecareperson) {
            const resSafezone = await api.getSafezone(
                resTakecareperson.takecare_id,
                resUser.users_id
            );
            if (resSafezone) {
                const resExtendedHelp = await getActiveExtendedHelp(
                    resTakecareperson.takecare_id,
                    resUser.users_id
                );

                // เช็คว่ามีเคสที่ยังไม่ปิดอยู่ → ส่งซ้ำไม่ได้
                if (
                    resExtendedHelp &&
                    !resExtendedHelp.exted_closed_date
                ) {
                    console.log(
                        `Temperature case still open. exten_id: ${resExtendedHelp.exten_id}`
                    );
                    return "already_sent";
                }

                // ไม่มีเคส หรือเคสเดิมปิดแล้ว → สร้างใหม่
                let extendedHelpId = null;
                const data = {
                    takecareId: resTakecareperson.takecare_id,
                    usersId: resUser.users_id,
                    typeStatus: "save",
                    safezLatitude: resSafezone.safez_latitude,
                    safezLongitude: resSafezone.safez_longitude,
                };
                const resNewId = await api.saveExtendedHelp(data);
                extendedHelpId = resNewId;

                const responseLocation = await getLocation(
                    resTakecareperson.takecare_id,
                    resUser.users_id,
                    resSafezone.safezone_id
                );

                // ส่งการแจ้งเตือนกลับ
                await replyNotification({
                    resUser,
                    resTakecareperson,
                    resSafezone,
                    extendedHelpId,
                    locationData: responseLocation,
                });

                // ส่ง Line ID กลับเป็นตัวบ่งชี้ว่า success (เหมือน safezone)
                return resUser.users_line_id;
            } else {
                console.log(
                    `NO SAFEZONE FOUND for takecare_id: ${resTakecareperson.takecare_id}, users_id: ${resUser.users_id}`
                );
            }
        } else {
            console.log(
                `USER or TAKECAREPERSON NOT FOUND. userLineId: ${userLineId}, takecarepersonId: ${takecarepersonId}`
            );
        }

        return null;
    } catch (error) {
        console.log(" ~ postbackTemp ~ error:", error);
        return null;
    }
};

export const postbackSafezone = async ({
    userLineId,
    takecarepersonId,
}: PostbackSafezoneProps) => {
    try {
        const resUser = await api.getUser(userLineId);
        const resTakecareperson = await api.getTakecareperson(
            takecarepersonId.toString(),
            resUser?.users_id
        );

        if (resUser && resTakecareperson) {
            const resSafezone = await api.getSafezone(
                resTakecareperson.takecare_id,
                resUser.users_id
            );
            if (resSafezone) {
                // เช็คตำแหน่งปัจจุบันว่าอยู่ในเขตปลอดภัยหรือไม่
                const currentStatus = await getCurrentLocationStatus(
                    resTakecareperson.takecare_id,
                    resUser.users_id
                );

                if (currentStatus === 0) {
                    console.log(
                        `User is already in safezone. Cannot send help request. takecare_id: ${resTakecareperson.takecare_id}, users_id: ${resUser.users_id}`
                    );
                    return "in_safezone";
                }

                const resExtendedHelp = await getActiveExtendedHelp(
                    resTakecareperson.takecare_id,
                    resUser.users_id
                );

                // เช็คว่ามีเคสที่ยังไม่ปิดอยู่ → ส่งซ้ำไม่ได้
                if (
                    resExtendedHelp &&
                    !resExtendedHelp.exted_closed_date
                ) {
                    console.log(
                        `Safezone case still open. exten_id: ${resExtendedHelp.exten_id}`
                    );
                    return "already_sent";
                }

                // ไม่มีเคส หรือเคสเดิมปิดแล้ว → สร้างใหม่
                let extendedHelpId = null;
                const data = {
                    takecareId: resTakecareperson.takecare_id,
                    usersId: resUser.users_id,
                    typeStatus: "save",
                    safezLatitude: resSafezone.safez_latitude,
                    safezLongitude: resSafezone.safez_longitude,
                };
                const resExtendedHelpId = await api.saveExtendedHelp(data);
                extendedHelpId = resExtendedHelpId;

                const responeLocation = await getLocation(
                    resTakecareperson.takecare_id,
                    resUser.users_id,
                    resSafezone.safezone_id
                );

                await replyNotification({
                    resUser,
                    resTakecareperson,
                    resSafezone,
                    extendedHelpId,
                    locationData: responeLocation,
                });
                return resUser.users_line_id;
            } else {
                console.log(
                    `NO SAFEZONE FOUND for takecare_id: ${resTakecareperson.takecare_id}, users_id: ${resUser.users_id}`
                );
            }
        } else {
            console.log(
                `USER or TAKECAREPERSON NOT FOUND. userLineId: ${userLineId}, takecarepersonId: ${takecarepersonId}`
            );
        }
        return null;
    } catch (error) {
        console.log(" ~ postbackSafezone ~ error:", error);
        return null;
    }
};

export const postbackAccept = async (data: any) => {
    try {
        const resUser = await api.getUser(data.userIdAccept);
        if (!resUser) {
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                message: "ไม่พบข้อมูลของคุณไม่สามารถรับเคสได้",
            });
            return null;
        }

        const resExtendedHelp = await api.getExtendedHelpById(data.extenId);
        if (!resExtendedHelp) return null;

        // ✨ ตรวจสอบว่ามีคนรับเคสไปแล้วหรือไม่ (เฉพาะกรณีปกติ)
        if (
            resExtendedHelp.exten_received_date &&
            resExtendedHelp.exten_received_user_id &&
            data.acceptMode !== "accept_call"
        ) {
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                title: "สถานะเคส",
                titleColor: "#1976D2",
                message: "มีผู้รับเคสช่วยเหลือแล้ว",
            });
            return null;
        }

        // ✨ ตรวจสอบว่าเป็นคนละคนกับที่รับเคสคนแรก (เฉพาะกรณี LIFF)
        // ถ้าเป็นคนละคน → block ไม่ให้เห็น Flex
        if (
            data.acceptMode === "accept_call" &&
            resExtendedHelp.exten_received_date &&
            resExtendedHelp.exten_received_user_id &&
            resExtendedHelp.exten_received_user_id !== resUser.users_id
        ) {
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                title: "สถานะเคส",
                titleColor: "#1976D2",
                message: "มีผู้รับเคสช่วยเหลือแล้ว",
            });
            return null;
        }

        // ✨ เช็คว่าเป็นครั้งแรกที่มีคนรับเคส หรือเป็นคนเดิมที่กดซ้ำ
        const isFirstAccept = !resExtendedHelp.exten_received_date;
        const isSameAcceptor =
            resExtendedHelp.exten_received_user_id === resUser.users_id;

        // update สถานะรับเคส
        await api.updateExtendedHelp({
            extenId: data.extenId,
            typeStatus: "received",
            extenReceivedUserId: resUser.users_id,
        });

        const closeCasePostbackDataNormal = `type=close&takecareId=${data.takecareId}&extenId=${data.extenId}&userLineId=${data.userLineId}`;
        const closeCasePostbackDataManual = `type=close&takecareId=${data.takecareId}&extenId=${data.extenId}&userLineId=${data.userLineId}&closeType=manual`;
        const closeCasePostbackDataAuto = `type=close&takecareId=${data.takecareId}&extenId=${data.extenId}&userLineId=${data.userLineId}&closeType=auto`;

        const isAcceptCallFlow = data.acceptMode === "accept_call";

        if (isAcceptCallFlow) {
            // ✨ แสดง Flex เฉพาะคนแรกที่รับเคส หรือคนเดิมที่กดซ้ำ
            if (isFirstAccept || isSameAcceptor) {
                let dependentFullName = "-";
                let dependentTel = "-";

                const dependentUser = await prisma.takecareperson.findFirst({
                    where: { users_id: Number(resExtendedHelp.user_id) },
                });
                if (dependentUser) {
                    dependentFullName = `${dependentUser.takecare_fname || ""} ${dependentUser.takecare_sname || ""}`.trim() || "-";
                    dependentTel = dependentUser.takecare_tel1 || dependentUser.takecare_tel_home || "-";
                }

                await replyNoti({
                    replyToken: data.groupId,
                    userIdAccept: data.userIdAccept,
                    title: "สถานะเคส",
                    titleColor: "#1976D2",
                    message: "ข้อมูลผู้มีภาวะพึ่งพิง",
                    detailRows: [
                        { label: "ชื่อ-สกุล", value: dependentFullName },
                        { label: "เบอร์โทร", value: dependentTel },
                    ],
                    buttons: [
                        {
                            type: "postback",
                            label: "ปิดเคสอัตโนมัติ",
                            data: closeCasePostbackDataAuto,
                        },
                        {
                            type: "postback",
                            label: "ปิดเคสด้วยตัวเอง",
                            data: closeCasePostbackDataManual,
                        },
                    ],
                });
            }
        } else {
            // ✨ กรณีปกติ ส่งทุกครั้ง
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                title: "สถานะเคส",
                titleColor: "#1976D2",
                message: "รับเคสช่วยเหลือแล้ว",
                buttons: [
                    {
                        type: "postback",
                        label: "ปิดเคสช่วยเหลือ",
                        data: closeCasePostbackDataNormal,
                    },
                ],
            });
        }

        return data.userLineId;

    } catch (error) {
        console.error("❌ postbackAccept error:", error);
        return null;
    }
};

export const postbackClose = async (data: any) => {
    try {
        const resUser = await api.getUser(data.userIdAccept);
        if (!resUser) {
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                title: "ไม่สามารถปิดเคสได้",
                titleColor: "#ff0000",
                message: "ไม่พบข้อมูลของคุณในระบบ",
            });
            return null;
        }

        const resExtendedHelp = await api.getExtendedHelpById(data.extenId);
        if (!resExtendedHelp) {
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                title: "ไม่พบข้อมูลเคส",
                titleColor: "#ff0000",
                message: "ไม่พบข้อมูลเคสช่วยเหลือนี้ในระบบ",
            });
            return null;
        }

        if (
            resExtendedHelp.exted_closed_date &&
            resExtendedHelp.exten_closed_user_id
        ) {
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                title: "สถานะเคส",
                titleColor: "#1976D2",
                message: "มีผู้ปิดเคสช่วยเหลือแล้ว",
            });
            return null;
        }

        if (
            !resExtendedHelp.exten_received_date &&
            !resExtendedHelp.exten_received_user_id
        ) {
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                title: "ไม่สามารถปิดเคสได้",
                titleColor: "#ff0000",
                message: "ไม่สามารถปิดเคสได้ เนื่องจากยังไม่ได้ตอบรับการช่วยเหลือ",
            });
            return null;
        }

        // อัพเดทสถานะปิดเคส
        await api.updateExtendedHelp({
            extenId: data.extenId,
            typeStatus: "close",
            extenClosedUserId: resUser.users_id,
        });

        // ✨ ตรวจสอบ closeType และเลือก message ที่เหมาะสม
        const closeType = data.closeType; // ไม่ใส่ default เพื่อให้รู้ว่าไม่มี closeType

        if (closeType === "manual") {
            // ✨ แบบที่ 2: ปิดเคสด้วยตัวเอง
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                title: "สถานะเคส",
                titleColor: "#1976D2",
                message: "ปิดเคสขอความช่วยเหลือด้วยตนเองแล้ว",
            });
            console.log(`✅ Case ${data.extenId} closed manually by user: ${resUser.users_id}`);
        } else if (closeType === "auto") {
            // ✨ แบบที่ 3: ปิดเคสทางหน้าเว็บ
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                title: "สถานะเคส",
                titleColor: "#1976D2",
                message: "ปิดเคสขอความช่วยเหลืออัตโนมัติแล้ว",
            });
            console.log(`✅ Case ${data.extenId} closed via web by user: ${resUser.users_id}`);
        } else {
            // ✨ แบบที่ 1: ปกติ - ส่ง replyNoti แทน replyNotification
            await replyNoti({
                replyToken: data.groupId,
                userIdAccept: data.userIdAccept,
                title: "สถานะเคส",
                titleColor: "#1976D2",
                message: "ปิดเคสขอความช่วยเหลือแล้ว",
            });
            console.log(`✅ Case ${data.extenId} closed (normal) by user: ${resUser.users_id}`);
        }

        return data.userLineId;
    } catch (error) {
        console.error("❌ postbackClose error:", error);
        return error;
    }
};