import withCommonData from '@/lib/withCommonData';
import { GetServerSideProps } from 'next';
import Image from 'next/image';
import { useRouter } from 'next/router';
import React, { useEffect, useState, useCallback } from 'react';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import ButtonState from '@/components/Button/ButtonState';
import InputLabel from '@/components/Form/InputLabel';
import SelectAddress from '@/components/Form/SelectAddress'; // 🔥 Import component ใหม่
import ModalAlert from '@/components/Modals/ModalAlert';
import axios from 'axios';
import md5 from 'md5';

// Import Validation
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registrationSchema, RegistrationFormData } from '@/components/validations/registrationSchema'; 

// 🔥 Import Hook ใหม่
import { useThaiAddress } from '@/hooks/useThaiAddress';

import styles from '@/styles/page.module.css';

interface UserData {
    isLogin: boolean;
    data: any | null
}

const Registration = () => {
    const router = useRouter();
    const [alert, setAlert] = useState({
        show: false,
        message: '',
        showClose: true,
        autoCloseMs: undefined as number | undefined,
        messageClassName: undefined as string | undefined
    });
    const [displayName, setDisplayName] = useState<string>("");
    const [dataUser, setDataUser] = useState<UserData>({ isLogin: true, data: null });
    const [confirmShow, setConfirmShow] = useState(false);
    const [pendingData, setPendingData] = useState<RegistrationFormData | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // 🔥 เรียกใช้ Thai Address Hook
    const { data, status, selected, actions, getNames, getLabel } = useThaiAddress();

    const { 
        register, 
        handleSubmit, 
        reset, 
        watch,
        setValue, // 🔥 เพื่อ sync ค่ากับ form
        formState: { errors, isSubmitting } 
    } = useForm<RegistrationFormData>({
        resolver: zodResolver(registrationSchema),
        mode: "onChange",
        defaultValues: {
            users_pin: "",
            users_tel1: "",
            users_tel_home: "",
            users_postcode: ""
        }
    });

    // 🔥 Sync ค่าจาก dropdown ไปยัง form
    useEffect(() => {
        if (selected.provinceId) {
            setValue('users_province', getNames.getProvinceName(selected.provinceId));
        }
        if (selected.districtId) {
            setValue('users_amphur', getNames.getDistrictName(selected.districtId));
        }
        if (selected.subDistrictId) {
            setValue('users_tubon', getNames.getSubDistrictName(selected.subDistrictId));
        }
        if (selected.zipCode) {
            setValue('users_postcode', selected.zipCode);
        }
    }, [selected, setValue, getNames]);

    const isFieldValid = (name: keyof RegistrationFormData) => {
        const value = watch(name);
        return !errors[name] && !!value && value.toString().trim() !== "";
    };

    useEffect(() => {
        const auToken = router.query.auToken
        if (auToken && typeof auToken === 'string') {
            onGetUserProfile(auToken)
            
            // เรียกใช้ตรงๆ แทนการพึ่ง function
            const fetchUserData = async () => {
                try {
                    const responseUser = await axios.get(`/api/user/getUser/${auToken}`);
                    if (responseUser.data?.data) {
                        const userData = responseUser.data.data;
                        setDataUser({ isLogin: false, data: userData });
                        
                        reset({
                            users_fname: userData.users_fname,
                            users_sname: userData.users_sname,
                            users_pin: userData.users_pin,
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

                        // Set initial address values for dropdown
                        if (userData.users_province && userData.users_amphur && userData.users_tubon) {
                            actions.setInitialValues(
                                userData.users_province,
                                userData.users_amphur,
                                userData.users_tubon,
                                userData.users_postcode
                            );
                        }

                    } else {
                        setDataUser({ isLogin: false, data: null })
                    }
                } catch (error) {
                    setDataUser({ isLogin: false, data: null })
                    setAlert({ 
                        show: true, 
                        message: 'ระบบไม่สามารถดึงข้อมูลของท่านได้ กรุณาลองใหม่อีกครั้ง',
                        showClose: true,
                        autoCloseMs: undefined,
                        messageClassName: undefined
                    })
                }
            };
            
            fetchUserData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router.query.auToken])

    const onGetUserProfile = async (auToken: string) => {
        try {
            const response = await axios.get(`/api/getProfile?id=${auToken}`);
            if (response.data) {
                setDisplayName(response.data.data?.displayName)
            }
        } catch (error) {
            setAlert({ 
                show: true, 
                message: 'ระบบไม่สามารถดึงข้อมูล LINE ของท่านได้ กรุณาลองใหม่อีกครั้ง',
                showClose: true,
                autoCloseMs: undefined,
                messageClassName: undefined
            })
        }
    }

    const onGetUserData = async (auToken: string) => {
        try {
                const responseUser = await axios.get(`/api/user/getUser/${auToken}`);
            if (responseUser.data?.data) {
                const userData = responseUser.data.data;
                setDataUser({ isLogin: false, data: userData });
                
                reset({
                    users_fname: userData.users_fname,
                    users_sname: userData.users_sname,
                    users_pin: userData.users_pin,
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

                // Set initial address values for dropdown
                if (userData.users_province && userData.users_amphur && userData.users_tubon) {
                    actions.setInitialValues(
                        userData.users_province,
                        userData.users_amphur,
                        userData.users_tubon,
                        userData.users_postcode
                    );
                }

            } else {
                setDataUser({ isLogin: false, data: null })
            }
        } catch (error) {
            setDataUser({ isLogin: false, data: null })
            setAlert({ 
                show: true, 
                message: 'ระบบไม่สามารถดึงข้อมูลของท่านได้ กรุณาลองใหม่อีกครั้ง',
                showClose: true,
                autoCloseMs: undefined,
                messageClassName: undefined
            })
        }
    }

    const onSubmit = async (formData: RegistrationFormData) => {
        if (!dataUser.data && (!formData.users_passwd || !formData.users_passwd_comfirm)) {
            setAlert({ 
                show: true, 
                message: 'กรุณากรอกรหัสผ่าน',
                showClose: true,
                autoCloseMs: undefined,
                messageClassName: undefined
            });
            throw new Error('กรุณากรอกรหัสผ่าน');
        }
        
        try {

            const data = {
                users_line_id: router.query.auToken,
                users_fname: formData.users_fname,
                users_passwd: formData.users_passwd ? md5(formData.users_passwd) : undefined,
                users_pin: formData.users_pin,
                status_id: 1,
                users_sname: formData.users_sname,
                users_number: formData.users_number,
                users_moo: formData.users_moo,
                users_road: formData.users_road,
                users_tubon: formData.users_tubon,
                users_amphur: formData.users_amphur,
                users_province: formData.users_province,
                users_postcode: formData.users_postcode,
                users_tel1: formData.users_tel1,
                users_tel_home: formData.users_tel_home,
            }

            await axios.post(`/api/registration/create`, data)
            
            // ✅ ย้าย onGetUserData ไปเรียกใน onConfirmSubmit แทน (เพื่อไม่ให้ขัดแย้งกับ alert)

        } catch (error) {
            setAlert({ 
                show: true, 
                message: 'ไม่สามารถบันทึกข้อมูลได้',
                showClose: true,
                autoCloseMs: undefined,
                messageClassName: undefined
            })
            throw error; // ✅ Re-throw เพื่อให้ onConfirmSubmit จัดการ
        }
    };

    // ✅ แก้ไข: ปิด popup ยืนยันก่อน แล้วค่อยแสดง success alert
    const onConfirmSubmit = async () => {
        if (!pendingData) return;
        setIsSaving(true);
        try {
            await onSubmit(pendingData);
            
            // ✅ รอให้ onGetUserData ทำงานเสร็จก่อน (ถ้ามี)
            if (typeof router.query.auToken === 'string') {
                try {
                    await onGetUserData(router.query.auToken);
                } catch (error) {
                    // ไม่ต้องทำอะไร - ข้อมูลอาจจะยังไม่พร้อม
                }
            }
            
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
                
                // ✅ ปิด alert อัตโนมัติหลัง 1.5 วินาที
                setTimeout(() => {
                    setAlert({
                        show: false,
                        message: '',
                        showClose: true,
                        autoCloseMs: undefined,
                        messageClassName: undefined
                    })
                }, 1500);
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

    const onPrepareSubmit = (formData: RegistrationFormData) => {
        setPendingData(formData);
        setConfirmShow(true);
    };

    return (
        <Container>
            <div className={styles.main}>
                <Image src={'/images/Logo.png'} width={100} height={100} alt="Logo" priority />
                <h1 className="py-2">ลงทะเบียน</h1>
            </div>
            <div className="px-5">
                <Form noValidate onSubmit={handleSubmit(onPrepareSubmit)}>
                    
                    <InputLabel 
                        label="ชื่อ" 
                        id="users_fname" 
                        placeholder="กรอกชื่อ" 
                        disabled={!!dataUser.data}
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
                        disabled={!!dataUser.data}
                        {...register("users_sname")}
                        isInvalid={!!errors.users_sname}
                        errorMessage={errors.users_sname?.message}
                        isValid={isFieldValid("users_sname")}
                        required
                    />

                    {
                        !dataUser.data && (
                            <>
                                <InputLabel 
                                    label="รหัสผ่าน" 
                                    id="users_passwd" 
                                    placeholder="กรอกรหัสผ่าน" 
                                    type="password" 
                                    disabled={!!dataUser.data}
                                    {...register("users_passwd")}
                                    isInvalid={!!errors.users_passwd}
                                    errorMessage={errors.users_passwd?.message}
                                    isValid={isFieldValid("users_passwd")}
                                    required
                                />
                                <InputLabel 
                                    label="ยืนยันรหัสผ่าน" 
                                    id="users_passwd_comfirm" 
                                    type="password" 
                                    disabled={!!dataUser.data}
                                    placeholder="กรอกยืนยันรหัสผ่าน" 
                                    {...register("users_passwd_comfirm")}
                                    isInvalid={!!errors.users_passwd_comfirm}
                                    errorMessage={errors.users_passwd_comfirm?.message}
                                    isValid={isFieldValid("users_passwd_comfirm")}
                                    required
                                />
                            </>
                        )
                    }

                    <InputLabel 
                        label="Pin 4 หลัก"
                        id="users_pin"
                        placeholder="1234" 
                        type="tel" 
                        max={4}
                        disabled={!!dataUser.data}
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
                        disabled={!!dataUser.data} 
                        {...register("users_number")} 
                        isValid={isFieldValid("users_number")}
                    />
                    <InputLabel 
                        label="หมู่" 
                        id="users_moo" 
                        placeholder="1" 
                        disabled={!!dataUser.data} 
                        {...register("users_moo")}
                        numericOnly
                        isValid={isFieldValid("users_moo")}
                    />
                    <InputLabel 
                        label="ถนน" 
                        id="users_road" 
                        placeholder="กรอกชื่อถนน" 
                        disabled={!!dataUser.data} 
                        {...register("users_road")}
                        isValid={isFieldValid("users_road")}
                    />
                    
                    {/* 🔥 เปลี่ยนจาก Input เป็น Dropdown */}
                    {status.loading ? (
                        <p className="text-muted">กำลังโหลดข้อมูลจังหวัด...</p>
                    ) : (
                        <>
                            <SelectAddress
                                label="จังหวัด"
                                id="users_province"
                                value={selected.provinceId}
                                options={data.provinces}
                                onChange={actions.setProvince}
                                disabled={!!dataUser.data || status.loading || !!status.error}
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
                                onChange={actions.setDistrict}
                                disabled={!!dataUser.data || !selected.provinceId}
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
                                onChange={actions.setSubDistrict}
                                disabled={!!dataUser.data || !selected.districtId}
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
                        disabled={!!dataUser.data}
                        {...register("users_postcode")}
                        isInvalid={!!errors.users_postcode}
                        isValid={isFieldValid("users_postcode")}
                        readOnly // 🔥 ทำให้เป็น read-only เพราะจะถูกกรอกอัตโนมัติ
                        required
                    />
                    
                    <InputLabel 
                        label=" เบอร์โทรศัพท์มือถือ" 
                        id="users_tel1" 
                        placeholder="กรอกเบอร์โทรศัพท์มือถือ" 
                        type="tel" 
                        max={10}
                        disabled={!!dataUser.data} 
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
                        disabled={!!dataUser.data} 
                        {...register("users_tel_home")}
                        isInvalid={!!errors.users_tel_home}
                        errorMessage={errors.users_tel_home?.message}
                        isValid={isFieldValid("users_tel_home")}
                    />

                    {
                        !dataUser.data && (
                            <Form.Group className="d-flex justify-content-center py-3">
                                <ButtonState 
                                    type="submit" 
                                    className={styles.button} 
                                    text={'บันทึก'} 
                                    icon="fas fa-save" 
                                    isLoading={isSaving} 
                                />
                            </Form.Group>
                        )
                    }

                </Form>
            </div>
            <ModalAlert
                show={alert.show}
                message={alert.message}
                showClose={alert.showClose}
                autoCloseMs={alert.autoCloseMs}
                messageClassName={alert.messageClassName}
                handleClose={() => setAlert({ 
                    show: false, 
                    message: '',
                    showClose: true,
                    autoCloseMs: undefined,
                    messageClassName: undefined
                })}
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

export const getServerSideProps: GetServerSideProps = withCommonData({
    title: 'ลงทะเบียน',
    description: 'ลงทะเบียน',
    slug: '',
    titleBar: 'ลงทะเบียน'
});

export default Registration
