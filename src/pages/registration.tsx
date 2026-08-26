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
        <Container className="registration-container">
            <div className="registration-header">
                <Image
                    src={'/images/Logo.png'}
                    width={90}
                    height={90}
                    alt="AFE+ Logo"
                    priority
                />

                <div className="registration-badge">
                    AFE PLUS
                </div>

                <h1>ลงทะเบียน</h1>
                <p>
                    กรุณากรอกข้อมูลให้ครบถ้วนเพื่อดำเนินการลงทะเบียน
                </p>
            </div>

            <div className="registration-form">
                <Form noValidate onSubmit={handleSubmit(onPrepareSubmit)}>

                    {/* ================= ข้อมูลส่วนตัว ================= */}
                    <section className="form-card">

                        <div className="card-header">
                            <div className="step-number">1</div>

                            <div>
                                <h2>ข้อมูลส่วนตัว</h2>
                                <p>กรุณากรอกข้อมูลพื้นฐานของผู้ใช้งาน</p>
                            </div>
                        </div>

                        <div className="form-grid">

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

                        </div>

                        {!dataUser.data && (
                            <div className="form-grid">

                                <InputLabel
                                    label="รหัสผ่าน"
                                    id="users_passwd"
                                    placeholder="กรอกรหัสผ่าน"
                                    type="password"
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
                                    placeholder="กรอกรหัสผ่านอีกครั้ง"
                                    {...register("users_passwd_comfirm")}
                                    isInvalid={!!errors.users_passwd_comfirm}
                                    errorMessage={errors.users_passwd_comfirm?.message}
                                    isValid={isFieldValid("users_passwd_comfirm")}
                                    required
                                />

                            </div>
                        )}

                        <div className="form-grid form-grid-small">

                            <InputLabel
                                label="PIN 4 หลัก"
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

                        </div>

                    </section>


                    {/* ================= ที่อยู่ ================= */}
                    <section className="form-card">

                        <div className="card-header">
                            <div className="step-number">2</div>

                            <div>
                                <h2>ข้อมูลที่อยู่</h2>
                                <p>กรุณาระบุที่อยู่ปัจจุบัน</p>
                            </div>
                        </div>


                        <div className="form-grid">

                            <InputLabel
                                label="เลขที่บ้าน"
                                id="users_number"
                                placeholder="เช่น 123/12"
                                disabled={!!dataUser.data}
                                {...register("users_number")}
                                isValid={isFieldValid("users_number")}
                            />

                            <InputLabel
                                label="หมู่"
                                id="users_moo"
                                placeholder="เช่น 1"
                                disabled={!!dataUser.data}
                                {...register("users_moo")}
                                numericOnly
                                isValid={isFieldValid("users_moo")}
                            />

                        </div>


                        <div className="form-row-full">

                            <InputLabel
                                label="ถนน"
                                id="users_road"
                                placeholder="กรอกชื่อถนน"
                                disabled={!!dataUser.data}
                                {...register("users_road")}
                                isValid={isFieldValid("users_road")}
                            />

                        </div>


                        {status.loading ? (
                            <div className="loading-address">
                                กำลังโหลดข้อมูลที่อยู่...
                            </div>
                        ) : (
                            <>
                                <div className="form-grid">

                                    <SelectAddress
                                        label="จังหวัด"
                                        id="users_province"
                                        value={selected.provinceId}
                                        options={data.provinces}
                                        onChange={actions.setProvince}
                                        disabled={
                                            !!dataUser.data ||
                                            status.loading ||
                                            !!status.error
                                        }
                                        placeholder="เลือกจังหวัด"
                                        isInvalid={!!errors.users_province}
                                        errorMessage={
                                            errors.users_province?.message
                                        }
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
                                        disabled={
                                            !!dataUser.data ||
                                            !selected.provinceId
                                        }
                                        placeholder={
                                            !selected.provinceId
                                                ? "เลือกจังหวัดก่อน"
                                                : "เลือกอำเภอ"
                                        }
                                        isInvalid={!!errors.users_amphur}
                                        errorMessage={
                                            errors.users_amphur?.message
                                        }
                                        isValid={isFieldValid("users_amphur")}
                                        required
                                        getLabel={getLabel}
                                    />

                                </div>


                                <div className="form-grid">

                                    <SelectAddress
                                        label="ตำบล"
                                        id="users_tubon"
                                        value={selected.subDistrictId}
                                        options={data.subDistricts}
                                        onChange={actions.setSubDistrict}
                                        disabled={
                                            !!dataUser.data ||
                                            !selected.districtId
                                        }
                                        placeholder={
                                            !selected.districtId
                                                ? "เลือกอำเภอก่อน"
                                                : "เลือกตำบล"
                                        }
                                        isInvalid={!!errors.users_tubon}
                                        errorMessage={
                                            errors.users_tubon?.message
                                        }
                                        isValid={isFieldValid("users_tubon")}
                                        required
                                        getLabel={getLabel}
                                    />

                                    <InputLabel
                                        label="รหัสไปรษณีย์"
                                        id="users_postcode"
                                        placeholder="กรอกอัตโนมัติ"
                                        type="tel"
                                        max={5}
                                        disabled={!!dataUser.data}
                                        {...register("users_postcode")}
                                        isInvalid={!!errors.users_postcode}
                                        isValid={isFieldValid("users_postcode")}
                                        readOnly
                                        required
                                    />

                                </div>
                            </>
                        )}

                    </section>


                    {/* ================= ข้อมูลติดต่อ ================= */}
                    <section className="form-card">

                        <div className="card-header">
                            <div className="step-number">3</div>

                            <div>
                                <h2>ข้อมูลติดต่อ</h2>
                                <p>ข้อมูลสำหรับติดต่อผู้ใช้งาน</p>
                            </div>
                        </div>

                        <div className="form-grid">

                            <InputLabel
                                label="เบอร์โทรศัพท์มือถือ"
                                id="users_tel1"
                                placeholder="08XXXXXXXX"
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
                                placeholder="กรอกเบอร์โทรศัพท์บ้าน (ถ้ามี)"
                                type="tel"
                                max={10}
                                disabled={!!dataUser.data}
                                {...register("users_tel_home")}
                                isInvalid={!!errors.users_tel_home}
                                errorMessage={errors.users_tel_home?.message}
                                isValid={isFieldValid("users_tel_home")}
                            />

                        </div>

                    </section>


                    {/* ================= ปุ่มบันทึก ================= */}
                    {!dataUser.data && (
                        <div className="submit-section">

                            <ButtonState
                                type="submit"
                                className="submit-button"
                                text="บันทึกข้อมูล"
                                icon="fas fa-save"
                                isLoading={isSaving}
                            />

                        </div>
                    )}

                </Form>
            </div>


            {/* Alert */}
            <ModalAlert
                show={alert.show}
                message={alert.message}
                showClose={alert.showClose}
                autoCloseMs={alert.autoCloseMs}
                messageClassName={alert.messageClassName}
                handleClose={() =>
                    setAlert({
                        show: false,
                        message: '',
                        showClose: true,
                        autoCloseMs: undefined,
                        messageClassName: undefined
                    })
                }
            />


            {/* Modal ยืนยัน */}
            <Modal
                show={confirmShow}
                centered
                onHide={onCancelSubmit}
            >
                <Modal.Header className="py-3">
                    <Modal.Title>
                        ยืนยันการบันทึกข้อมูล
                    </Modal.Title>
                </Modal.Header>

                <Modal.Body>
                    โปรดตรวจสอบความถูกต้องของข้อมูลก่อนยืนยันการบันทึกเข้าสู่ระบบ
                </Modal.Body>

                <Modal.Footer>
                    <Button
                        variant="secondary"
                        size="lg"
                        onClick={onCancelSubmit}
                    >
                        ยกเลิก
                    </Button>

                    <Button
                        variant="primary"
                        size="lg"
                        onClick={onConfirmSubmit}
                        disabled={isSaving}
                    >
                        {isSaving ? "กำลังบันทึก..." : "ยืนยัน"}
                    </Button>
                </Modal.Footer>
            </Modal>

            <style jsx global>{`
/* ===============================
   Registration Page
================================ */

.registration-container {
    max-width: 850px;
    padding: 25px 15px 70px;
}


/* Header */

.registration-header {
    text-align: center;
    margin-bottom: 35px;
}

.registration-header h1 {
    margin-top: 12px;
    margin-bottom: 8px;
    font-size: 2rem;
    font-weight: 700;
}

.registration-header p {
    margin: 0;
    font-size: 1.05rem;
    color: #666;
}

.registration-badge {
    display: inline-block;
    margin-top: 12px;
    padding: 5px 16px;

    border-radius: 20px;

    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 1px;

    background: #e8f5e9;
    color: #168c2f;
}


/* ===============================
   Form Card
================================ */

.form-card {
    background: #ffffff;

    border: 1px solid #e8e8e8;
    border-radius: 16px;

    padding: 30px;
    margin-bottom: 25px;

    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.05);
}


/* Card Header */

.card-header {
    display: flex;
    align-items: center;

    gap: 14px;

    padding-bottom: 18px;
    margin-bottom: 25px;

    border-bottom: 1px solid #eeeeee;
}

.card-header h2 {
    margin: 0;

    font-size: 1.3rem;
    font-weight: 700;
}

.card-header p {
    margin: 3px 0 0;

    font-size: 0.95rem;
    color: #777;
}


/* Step Number */

.step-number {
    display: flex;

    align-items: center;
    justify-content: center;

    width: 42px;
    height: 42px;

    flex-shrink: 0;

    border-radius: 50%;

    font-size: 1.2rem;
    font-weight: bold;

    background: #00b900;
    color: white;
}


/* ===============================
   Form Grid
================================ */

.form-grid {
    display: grid;

    grid-template-columns: repeat(2, 1fr);

    gap: 20px;

    margin-bottom: 20px;
}

.form-grid-small {
    max-width: 50%;
}

.form-row-full {
    width: 100%;
    margin-bottom: 20px;
}


/* Loading */

.loading-address {
    padding: 20px;

    text-align: center;

    border-radius: 10px;

    background: #f5f5f5;
    color: #777;
}


/* ===============================
   Submit Button
================================ */

.submit-section {
    display: flex;
    justify-content: center;

    margin-top: 35px;
}

.submit-button {
    width: 100%;
    max-width: 420px;

    min-height: 56px;

    border-radius: 28px !important;

    font-size: 1.15rem !important;
    font-weight: 700 !important;
}


/* ===============================
   Mobile
================================ */

@media (max-width: 600px) {

    .registration-container {
        padding: 20px 10px 50px;
    }

    .registration-header h1 {
        font-size: 1.7rem;
    }

    .registration-header p {
        font-size: 0.95rem;
    }


    .form-card {
        padding: 20px 16px;

        border-radius: 12px;
    }


    .card-header {
        margin-bottom: 20px;
    }


    .card-header h2 {
        font-size: 1.15rem;
    }

    .card-header p {
        font-size: 0.85rem;
    }


    /* จาก 2 ช่อง → 1 ช่อง */

    .form-grid {
        grid-template-columns: 1fr;

        gap: 16px;
    }


    .form-grid-small {
        max-width: 100%;
    }


    .step-number {
        width: 38px;
        height: 38px;

        font-size: 1rem;
    }

}

`}</style>
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
