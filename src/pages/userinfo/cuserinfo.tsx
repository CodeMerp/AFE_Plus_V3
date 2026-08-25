'use client'
import React, { useEffect, useState } from 'react'
import Container from 'react-bootstrap/Container';
import axios from 'axios';
import { useRouter } from 'next/router'

import styles from '@/styles/page.module.css'

import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';

import InputLabel from '@/components/Form/InputLabel'
import SelectAddress from '@/components/Form/SelectAddress';
import ModalAlert from '@/components/Modals/ModalAlert'
import ButtonState from '@/components/Button/ButtonState';

// 🔥 Import Validation
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { userEditSchema, UserEditFormData } from '@/components/validations/cuserinfoSchema';

// 🔥 Import Hook
import { useThaiAddress } from '@/hooks/useThaiAddress';
import { encrypt } from '@/utils/helpers'

interface UserData {
    isLogin: boolean;
    data: UserDataProps | null
}

const Cuserinfo = () => {
    const router = useRouter();
    const [alert, setAlert] = useState({
        show: false,
        message: '',
        showClose: true,
        autoCloseMs: undefined as number | undefined,
        messageClassName: undefined as string | undefined
    });
    const [dataUser, setDataUser] = useState<UserData>({ isLogin: false, data: null })
    const [confirmShow, setConfirmShow] = useState(false);
    const [pendingData, setPendingData] = useState<UserEditFormData | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // 🔥 เรียกใช้ Thai Address Hook
    const { data, status, selected, actions, getNames, getLabel } = useThaiAddress();

    // 🔥 ใช้ React Hook Form
    const { 
        register, 
        handleSubmit, 
        reset, 
        watch,
        setValue,
        formState: { errors, dirtyFields } // 🔥 เพิ่ม dirtyFields
    } = useForm<UserEditFormData>({
        resolver: zodResolver(userEditSchema),
        mode: "onChange",
        defaultValues: {
            users_pin: "",
            users_tel1: "",
            users_tel_home: "",
            users_postcode: ""
        }
    });

    // ❌ ลบ useEffect ที่ใช้ Sync ค่าเดิมออกแล้ว (เพื่อไม่ให้ตีกับ onChange)

    // 🔥 ฟังก์ชันเช็คว่าควรขึ้น "สีเขียว" หรือไม่
    // เงื่อนไข: ไม่มี Error + มีค่า + และ "มีการแก้ไขแล้ว" (dirty)
    const isFieldValid = (name: keyof UserEditFormData) => {
        const value = watch(name);
        const hasError = !!errors[name];
        const isDirty = dirtyFields[name]; 

        return !hasError && !!value && value.toString().trim() !== "" && !!isDirty;
    };

    useEffect(() => {
        const auToken = router.query.auToken
        if (auToken) {
            const fetchUserData = async () => {
                try {
                    const responseUser = await axios.get(`/api/user/getUser/${auToken}`);
                    if (responseUser.data?.data) {
                        const userData = responseUser.data.data;
                        setDataUser({ isLogin: false, data: userData });

                        // 🔥 ใช้ reset เพื่อกำหนดค่าเริ่มต้นให้กับ form
                        reset({
                            users_fname: userData.users_fname,
                            users_sname: userData.users_sname,
                            users_pin: String(userData.users_pin),
                            users_number: userData.users_number,
                            users_moo: userData.users_moo,
                            users_road: userData.users_road,
                            users_tubon: userData.users_tubon,
                            users_amphur: userData.users_amphur,
                            users_province: userData.users_province,
                            users_postcode: userData.users_postcode,
                            users_tel1: userData.users_tel1,
                            users_tel_home: userData.users_tel_home,
                        });
                    } else {
                        setDataUser({ isLogin: false, data: null })
                    }
                } catch (error) {
                    console.log("🚀 ~ file: Cuserinfo.tsx ~ onGetUserData ~ error:", error)
                    setDataUser({ isLogin: false, data: null })
                    setAlert({ show: true, message: 'ระบบไม่สามารถดึงข้อมูลของท่านได้ กรุณาลองใหม่อีกครั้ง', showClose: true, autoCloseMs: undefined, messageClassName: undefined })
                }
            };
            fetchUserData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router.query.auToken])

    // 🔥 useEffect แยกสำหรับ set dropdown เมื่อข้อมูลจังหวัดโหลดเสร็จแล้ว
    useEffect(() => {
        if (dataUser.data && data.provinces.length > 0) {
            const userData = dataUser.data;
            if (userData.users_province && userData.users_amphur && userData.users_tubon) {
                actions.setInitialValues(
                    userData.users_province,
                    userData.users_amphur,
                    userData.users_tubon,
                    userData.users_postcode
                );
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataUser.data, data.provinces.length])

    const onSubmit = async (formData: UserEditFormData) => {
        try {
            if (!dataUser.data) return;

            const data = {
                users_fname   : formData.users_fname,
                users_sname   : formData.users_sname,
                users_pin     : Number(formData.users_pin),
                users_number  : formData.users_number,
                users_moo     : formData.users_moo,
                users_road    : formData.users_road,
                users_tubon   : formData.users_tubon,
                users_amphur  : formData.users_amphur,
                users_province: formData.users_province,
                users_postcode: formData.users_postcode,
                users_tel1    : formData.users_tel1,
                users_tel_home: formData.users_tel_home,
            }

            const encodedUsersId = encrypt(dataUser.data.users_id.toString());
            await axios.post(`/api/user/updateUser/${encodedUsersId}`, data)
            
            if (router.query.auToken) {
                const responseUser = await axios.get(`/api/user/getUser/${router.query.auToken}`);
                if (responseUser.data?.data) {
                    setDataUser({ isLogin: false, data: responseUser.data.data });
                }
            }
            
            // ✅ ลบ setAlert ออกจาก onSubmit (จะย้ายไปแสดงใน onConfirmSubmit แทน)

        } catch (error) {
            console.error('Error in handleSubmit:', error);
            setAlert({ show: true, message: 'ไม่สามารถบันทึกข้อมูลได้', showClose: true, autoCloseMs: undefined, messageClassName: undefined })
        }
    };

    // ✅ แก้ไข: ปิด popup ยืนยันก่อน แล้วค่อยแสดง success alert
    const onConfirmSubmit = async () => {
        if (!pendingData) return;
        setIsSaving(true);
        try {
            await onSubmit(pendingData);
            // ✅ ปิด popup ยืนยันก่อน
            setConfirmShow(false);
            setPendingData(null);
            
            // ✅ หน่วงเวลานิดหนึ่งแล้วค่อยแสดง success alert
            setTimeout(() => {
                setAlert({
                    show: true,
                    message: 'บันทึกข้อมูลแล้ว',
                    showClose: false,
                    autoCloseMs: 1500,
                    messageClassName: 'fs-3 fw-bold text-center'
                })
            }, 300);
        } catch (error) {
            console.error('Error in onConfirmSubmit:', error);
            // ปิด popup ยืนยันแม้เกิด error
            setConfirmShow(false);
            setPendingData(null);
        } finally {
            setIsSaving(false);
        }
    };

    const onCancelSubmit = () => {
        setConfirmShow(false);
        setPendingData(null);
    };

    const onPrepareSubmit = (formData: UserEditFormData) => {
        setPendingData(formData);
        setConfirmShow(true);
    };

    if (dataUser.isLogin) return <div>loading...</div>;
    return (
        <Container>
            <div className={styles.main}>
                <h1 className="py-2">ข้อมูลผู้ดูแล</h1>
            </div>
            <div className="px-5">
                <Form noValidate onSubmit={handleSubmit(onPrepareSubmit)}>
                    
                    <InputLabel 
                        label="ชื่อ" 
                        id="users_fname" 
                        placeholder="กรอกชื่อ" 
                        {...register("users_fname")}
                        isInvalid={!!errors.users_fname}
                        errorMessage={errors.users_fname?.message}
                        isValid={isFieldValid("users_fname")}
                        required
                    />

                    <InputLabel 
                        label="นามสกุล" 
                        id="users_sname" 
                        placeholder="กรอกนามสกุล" 
                        {...register("users_sname")}
                        isInvalid={!!errors.users_sname}
                        errorMessage={errors.users_sname?.message}
                        isValid={isFieldValid("users_sname")}
                        required
                    />

                    <InputLabel 
                        label="Pin 4 หลัก" 
                        id="users_pin" 
                        placeholder="กรอก Pin 4 หลัก" 
                        type="tel" 
                        max={4}
                        {...register("users_pin")}
                        isInvalid={!!errors.users_pin}
                        errorMessage={errors.users_pin?.message}
                        isValid={isFieldValid("users_pin")}
                        required
                    />

                    <InputLabel 
                        label="เลขที่บ้าน" 
                        id="users_number" 
                        placeholder="123/12" 
                        max={10}
                        {...register("users_number")}
                        isValid={isFieldValid("users_number")}
                    />

                    <InputLabel 
                        label="หมู่" 
                        id="users_moo" 
                        placeholder="1" 
                        max={5}
                        {...register("users_moo")}
                        numericOnly
                        isValid={isFieldValid("users_moo")}
                    />

                    <InputLabel 
                        label="ถนน" 
                        id="users_road" 
                        placeholder="-"
                        {...register("users_road")}
                        isValid={isFieldValid("users_road")}
                    />

                    {/* 🔥 ส่วนที่อยู่แบบ Manual Control */}
                    {status.loading ? (
                        <p className="text-muted">กำลังโหลดข้อมูลจังหวัด...</p>
                    ) : (
                        <>
                            <input type="hidden" {...register("users_province")} />
                            <input type="hidden" {...register("users_amphur")} />
                            <input type="hidden" {...register("users_tubon")} />
                            
                            <SelectAddress
                                label="จังหวัด"
                                id="users_province"
                                value={selected.provinceId}
                                options={data.provinces}
                                onChange={(id) => {
                                    actions.setProvince(id); 
                                    const name = getNames.getProvinceName(id);
                                    
                                    // อัปเดต + Validate + Dirty
                                    setValue("users_province", name, { shouldValidate: true, shouldDirty: true });

                                    // ถ้าเปลี่ยนจังหวัด หรือ เลือกค่าว่าง -> ล้างลูกข่ายทั้งหมด
                                    setValue("users_amphur", "", { shouldValidate: true, shouldDirty: true });
                                    setValue("users_tubon", "", { shouldValidate: true, shouldDirty: true });
                                    setValue("users_postcode", "", { shouldValidate: true, shouldDirty: true });
                                }}
                                placeholder="เลือกจังหวัด"
                                isInvalid={!!errors.users_province}
                                errorMessage={errors.users_province?.message}
                                isValid={isFieldValid("users_province")}
                                required
                                getLabel={getLabel}
                            />

                            <SelectAddress
                                label="อำเภอ"
                                id="users_amphur"
                                value={selected.districtId}
                                options={data.districts}
                                onChange={(id) => {
                                    actions.setDistrict(id);
                                    const name = getNames.getDistrictName(id);
                                    setValue("users_amphur", name, { shouldValidate: true, shouldDirty: true });
                                    
                                    // ถ้าเปลี่ยนอำเภอ -> ล้างตำบลและไปรษณีย์
                                    setValue("users_tubon", "", { shouldValidate: true, shouldDirty: true });
                                    setValue("users_postcode", "", { shouldValidate: true, shouldDirty: true });
                                }}
                                disabled={!selected.provinceId}
                                placeholder={!selected.provinceId ? "เลือกจังหวัดก่อน" : "เลือกอำเภอ"}
                                isInvalid={!!errors.users_amphur}
                                errorMessage={errors.users_amphur?.message}
                                isValid={isFieldValid("users_amphur")}
                                required
                                getLabel={getLabel}
                            />

                            <SelectAddress
                                label="ตำบล"
                                id="users_tubon"
                                value={selected.subDistrictId}
                                options={data.subDistricts}
                                onChange={(id) => {
                                    actions.setSubDistrict(id);
                                    const name = getNames.getSubDistrictName(id);
                                    setValue("users_tubon", name, { shouldValidate: true, shouldDirty: true });
                                    
                                    // ดึงรหัสไปรษณีย์
                                    const subDist = data.subDistricts.find(s => s.id === Number(id));
                                    const zipCode = subDist?.zip_code ? String(subDist.zip_code) : "";
                                    setValue("users_postcode", zipCode, { shouldValidate: true, shouldDirty: true });
                                }}
                                disabled={!selected.districtId}
                                placeholder={!selected.districtId ? "เลือกอำเภอก่อน" : "เลือกตำบล"}
                                isInvalid={!!errors.users_tubon}
                                errorMessage={errors.users_tubon?.message}
                                isValid={isFieldValid("users_tubon")}
                                required
                                getLabel={getLabel}
                            />
                        </>
                    )}

                    <InputLabel 
                        label="รหัสไปรษณีย์" 
                        id="users_postcode" 
                        placeholder="รหัสไปรษณีย์จะถูกกรอกอัตโนมัติ" 
                        type="tel" 
                        max={5}
                        {...register("users_postcode")}
                        isInvalid={!!errors.users_postcode}
                        isValid={isFieldValid("users_postcode")}
                        readOnly
                        required
                    />

                    <InputLabel 
                        label="เบอร์โทรศัพท์มือถือ" 
                        id="users_tel1" 
                        placeholder="กรอกเบอร์โทรศัพท์มือถือ" 
                        type="tel" 
                        max={10}
                        {...register("users_tel1")}
                        isInvalid={!!errors.users_tel1}
                        errorMessage={errors.users_tel1?.message}
                        isValid={isFieldValid("users_tel1")}
                        required
                    />


                    <InputLabel 
                        label="เบอร์โทรศัพท์บ้าน" 
                        id="users_tel_home" 
                        placeholder="กรอกเบอร์โทรศัพท์บ้าน" 
                        type="tel" 
                        max={10}
                        {...register("users_tel_home")}
                        isInvalid={!!errors.users_tel_home}
                        errorMessage={errors.users_tel_home?.message}
                        isValid={isFieldValid("users_tel_home")}
                    />

                    <Form.Group className="d-flex justify-content-center py-3">
                        <ButtonState 
                            type="submit" 
                            className={styles.button} 
                            text={'บันทึก'} 
                            icon="fas fa-save" 
                            isLoading={isSaving}
                        />
                    </Form.Group>

                </Form>
            </div>
            <ModalAlert
                show={alert.show}
                message={alert.message}
                showClose={alert.showClose}
                autoCloseMs={alert.autoCloseMs}
                messageClassName={alert.messageClassName}
                handleClose={() => setAlert({ show: false, message: '', showClose: true, autoCloseMs: undefined, messageClassName: undefined })}
            />
            {/* ✅ Modal ยืนยันการบันทึก - ลบปุ่ม X แล้ว */}
            <Modal show={confirmShow} centered onHide={onCancelSubmit}>
                <Modal.Header className="py-2">
                    <h5 className="m-0">ยืนยันการบันทึกข้อมูล AFE+</h5>
                </Modal.Header>
                <Modal.Body>
                    <p>โปรดตรวจสอบความถูกต้องของข้อมูลก่อนยืนยันการบันทึกเข้าสู่ระบบ</p>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" size="lg" className="px-4" onClick={onCancelSubmit}>
                        ยกเลิก
                    </Button>
                    <Button variant="primary" size="lg" className="px-4" onClick={onConfirmSubmit} disabled={isSaving}>
                        {isSaving ? 'กำลังบันทึก...' : 'ตกลง'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </Container>
    )
}

export default Cuserinfo
