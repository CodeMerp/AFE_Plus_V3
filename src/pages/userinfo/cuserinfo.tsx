'use client'
import React, { useEffect, useState } from 'react'
import Container from 'react-bootstrap/Container';
import axios from 'axios';
import { useRouter } from 'next/router'
import Image from 'next/image';

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

    // 🔥 ฟังก์ชันเช็คว่าควรขึ้น "สีเขียว" หรือไม่
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
        } catch (error) {
            console.error('Error in handleSubmit:', error);
            setAlert({ show: true, message: 'ไม่สามารถบันทึกข้อมูลได้', showClose: true, autoCloseMs: undefined, messageClassName: undefined })
        }
    };

    const onConfirmSubmit = async () => {
        if (!pendingData) return;
        setIsSaving(true);
        try {
            await onSubmit(pendingData);
            setConfirmShow(false);
            setPendingData(null);
            
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
        <Container className="profile-container">
            {/* Header */}
            <div className="profile-header">
                <Image
                    src={'/images/Logo.png'}
                    width={90}
                    height={90}
                    alt="AFE+ Logo"
                    priority
                />

                <div className="profile-badge">
                    AFE PLUS
                </div>

                <h1>ข้อมูลผู้ดูแล</h1>
                <p>
                    กรุณากรอกและตรวจสอบข้อมูลให้ครบถ้วนเพื่อทำการบันทึก
                </p>
            </div>

            <div className="profile-form">
                <Form noValidate onSubmit={handleSubmit(onPrepareSubmit)}>
                    
                    {/* ================= Section 1: ข้อมูลส่วนตัว ================= */}
                    <section className="form-card">
                        <div className="card-header">
                            <div className="step-number">1</div>
                            <div>
                                <h2>ข้อมูลส่วนตัว</h2>
                                <p>ข้อมูลพื้นฐานและรหัสความปลอดภัยของผู้ดูแล</p>
                            </div>
                        </div>

                        <div className="form-grid">
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
                        </div>

                        <div className="form-grid form-grid-small">
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
                        </div>
                    </section>


                    {/* ================= Section 2: ข้อมูลที่อยู่ ================= */}
                    <section className="form-card">
                        <div className="card-header">
                            <div className="step-number">2</div>
                            <div>
                                <h2>ข้อมูลที่อยู่</h2>
                                <p>กรุณาระบุที่อยู่ปัจจุบันของผู้ดูแล</p>
                            </div>
                        </div>

                        <div className="form-grid">
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
                        </div>

                        <div className="form-row-full">
                            <InputLabel 
                                label="ถนน" 
                                id="users_road" 
                                placeholder="-"
                                {...register("users_road")}
                                isValid={isFieldValid("users_road")}
                            />
                        </div>

                        {status.loading ? (
                            <div className="loading-address">
                                กำลังโหลดข้อมูลจังหวัด...
                            </div>
                        ) : (
                            <>
                                <input type="hidden" {...register("users_province")} />
                                <input type="hidden" {...register("users_amphur")} />
                                <input type="hidden" {...register("users_tubon")} />
                                
                                <div className="form-grid">
                                    <SelectAddress
                                        label="จังหวัด"
                                        id="users_province"
                                        value={selected.provinceId}
                                        options={data.provinces}
                                        onChange={(id) => {
                                            actions.setProvince(id); 
                                            const name = getNames.getProvinceName(id);
                                            setValue("users_province", name, { shouldValidate: true, shouldDirty: true });
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
                                </div>

                                <div className="form-grid">
                                    <SelectAddress
                                        label="ตำบล"
                                        id="users_tubon"
                                        value={selected.subDistrictId}
                                        options={data.subDistricts}
                                        onChange={(id) => {
                                            actions.setSubDistrict(id);
                                            const name = getNames.getSubDistrictName(id);
                                            setValue("users_tubon", name, { shouldValidate: true, shouldDirty: true });
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
                                </div>
                            </>
                        )}
                    </section>


                    {/* ================= Section 3: ข้อมูลติดต่อ ================= */}
                    <section className="form-card">
                        <div className="card-header">
                            <div className="step-number">3</div>
                            <div>
                                <h2>ข้อมูลติดต่อ</h2>
                                <p>ช่องทางสำหรับติดต่อผู้ดูแล</p>
                            </div>
                        </div>

                        <div className="form-grid">
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
                        </div>
                    </section>


                    {/* ================= ปุ่มบันทึก ================= */}
                    <div className="submit-section">
                        <ButtonState 
                            type="submit" 
                            className="submit-button" 
                            text={'บันทึกข้อมูล'} 
                            icon="fas fa-save" 
                            isLoading={isSaving}
                        />
                    </div>

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

            <Modal show={confirmShow} centered onHide={onCancelSubmit}>
                <Modal.Header className="py-3">
                    <Modal.Title>ยืนยันการบันทึกข้อมูล</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p className="m-0">โปรดตรวจสอบความถูกต้องของข้อมูลก่อนยืนยันการบันทึกเข้าสู่ระบบ</p>
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

            <style jsx global>{`
                /* ===============================
                   Profile Page Style
                ================================ */

                .profile-container {
                    max-width: 850px;
                    padding: 25px 15px 70px;
                }

                /* Header */
                .profile-header {
                    text-align: center;
                    margin-bottom: 35px;
                }

                .profile-header h1 {
                    margin-top: 12px;
                    margin-bottom: 8px;
                    font-size: 2rem;
                    font-weight: 700;
                }

                .profile-header p {
                    margin: 0;
                    font-size: 1.05rem;
                    color: #666;
                }

                .profile-badge {
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
                    .profile-container {
                        padding: 20px 10px 50px;
                    }
                    .profile-header h1 {
                        font-size: 1.7rem;
                    }
                    .profile-header p {
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

export default Cuserinfo