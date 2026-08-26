'use client'
import React, { useEffect, useState } from 'react'
import { GetServerSideProps } from 'next';
import Image from 'next/image';
import { useRouter } from 'next/router';
import Container from 'react-bootstrap/Container';

import withCommonData from '@/lib/withCommonData';

import styles from '@/styles/page.module.css'

import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';

import InputLabel from '@/components/Form/InputLabel'
import SelectAddress from '@/components/Form/SelectAddress';
import ModalAlert from '@/components/Modals/ModalAlert'
import ButtonState from '@/components/Button/ButtonState';
import DatePickerX from '@/components/DatePicker/DatePickerX';
import { encrypt } from '@/utils/helpers'

// 🔥 Import Validation
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { elderlyRegistrationSchema, ElderlyRegistrationFormData } from '@/components/validations/elderlyRegistrationSchema';

import ChronicDiseaseSelect from '@/components/Form/ChronicDiseaseSelect';
import { useThaiAddress } from '@/hooks/useThaiAddress';

import axios from 'axios';

interface UserTakecareData {
    isLogin: boolean;
    data: {
        users_id         ?: number;
        takecare_fname   ?: string;
        takecare_sname   ?: string;
        takecare_birthday?: string;
        gender_id        ?: number;
        marry_id         ?: number;
        takecare_number  ?: string;
        takecare_moo     ?: string;
        takecare_road    ?: string;
        takecare_tubon   ?: string;
        takecare_amphur  ?: string;
        takecare_province?: string;
        takecare_postcode?: string;
        takecare_tel1    ?: string;
        takecare_tel_home?: string;
        takecare_disease ?: string;
        takecare_drug    ?: string;
        takecare_status  ?: number;
    } | null;
    users_id: number | null;
}

const ElderlyRegistration = () => {
    const router = useRouter();

    const [alert, setAlert] = useState({
        show: false,
        message: '',
        showClose: true,
        autoCloseMs: undefined as number | undefined,
        messageClassName: undefined as string | undefined
    });
    const [displayName, setDisplayName] = useState<string>("");
    const [dataUser, setDataUser] = useState<UserTakecareData>({ isLogin: true, data: null, users_id: null });
    const [masterGender, setMasterGender] = useState<[]>([]);
    const [masterMarry, setMasterMarry] = useState<[]>([]);
    const [confirmShow, setConfirmShow] = useState(false);
    const [pendingData, setPendingData] = useState<ElderlyRegistrationFormData | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [sameAddress, setSameAddress] = useState(false);
    const [isLoadingCaregiverAddress, setIsLoadingCaregiverAddress] = useState(false);

    // 🔥 เรียกใช้ Thai Address Hook
    const { data, status, selected, actions, getNames, getLabel } = useThaiAddress();

    // 🔥 ใช้ React Hook Form
    const { 
        register, 
        handleSubmit, 
        reset, 
        watch,
        setValue,
        control,
        formState: { errors } 
    } = useForm<ElderlyRegistrationFormData>({
        resolver: zodResolver(elderlyRegistrationSchema),
        mode: "onChange",
        defaultValues: {
            takecare_birthday: new Date(),
        }
    });

    // 🔥 Sync ค่าจาก dropdown ไปยัง form
    useEffect(() => {
        if (selected.provinceId) {
            setValue('takecare_province', getNames.getProvinceName(selected.provinceId), { shouldValidate: true });
        }
        if (selected.districtId) {
            setValue('takecare_amphur', getNames.getDistrictName(selected.districtId), { shouldValidate: true });
        }
        if (selected.subDistrictId) {
            setValue('takecare_tubon', getNames.getSubDistrictName(selected.subDistrictId), { shouldValidate: true });
        }
        if (selected.zipCode) {
            setValue('takecare_postcode', selected.zipCode, { shouldValidate: true });
        }
    }, [selected, setValue, getNames]);

    // 🔥 ฟังก์ชันเช็คว่าควรขึ้น "สีเขียว" หรือไม่
    const isFieldValid = (name: keyof ElderlyRegistrationFormData) => {
        const value = watch(name);
        if (name === 'takecare_birthday' || name === 'gender_id' || name === 'marry_id') {
            return !errors[name] && !!value;
        }
        return !errors[name] && !!value && value.toString().trim() !== "";
    };

    useEffect(() => {
        getMasterData()
        const auToken = router.query.auToken

        if (auToken && typeof auToken === 'string') {
            onGetUserProfile(auToken)
            
            const fetchUserData = async () => {
                try {
                    const responseUser = await axios.get(`/api/user/getUser/${auToken}`);
                    if (responseUser.data?.data) {
                        const encodedUsersId = encrypt(responseUser.data?.data.users_id.toString());
                        
                        const responseTakecareperson = await axios.get(`/api/user/getUserTakecareperson/${encodedUsersId}`);
                        const takecareData = responseTakecareperson.data?.data;
                        
                        if (takecareData) {
                            reset({
                                takecare_fname: takecareData.takecare_fname,
                                takecare_sname: takecareData.takecare_sname,
                                takecare_birthday: new Date(takecareData.takecare_birthday),
                                gender_id: takecareData.gender_id,
                                marry_id: takecareData.marry_id,
                                takecare_number: takecareData.takecare_number,
                                takecare_moo: takecareData.takecare_moo,
                                takecare_road: takecareData.takecare_road,
                                takecare_tubon: takecareData.takecare_tubon,
                                takecare_amphur: takecareData.takecare_amphur,
                                takecare_province: takecareData.takecare_province,
                                takecare_postcode: takecareData.takecare_postcode,
                                takecare_tel1: takecareData.takecare_tel1,
                                takecare_tel_home: takecareData.takecare_tel_home,
                                takecare_disease: takecareData.takecare_disease,
                                takecare_drug: takecareData.takecare_drug,
                            });
                        }
                        
                        setDataUser({ 
                            isLogin: false, 
                            data: takecareData, 
                            users_id: responseUser.data?.data.users_id 
                        });
                    } else {
                        setDataUser({ isLogin: false, data: null, users_id: null })
                    }
                } catch (error) {
                    console.log("🚀 ~ file: elderly-registration.tsx ~ fetchUserData ~ error:", error)
                    setDataUser({ isLogin: false, data: null, users_id: null })
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

    // 🔥 useEffect แยกสำหรับ set dropdown เมื่อข้อมูลจังหวัดโหลดเสร็จแล้ว
    useEffect(() => {
        if (dataUser.data && data.provinces.length > 0) {
            const takecareData = dataUser.data;
            if (takecareData.takecare_province && takecareData.takecare_amphur && takecareData.takecare_tubon) {
                actions.setInitialValues(
                    takecareData.takecare_province,
                    takecareData.takecare_amphur,
                    takecareData.takecare_tubon,
                    takecareData.takecare_postcode
                );
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataUser.data, data.provinces.length])

    const getMasterData = async () => {
        try {
            const response1 = await axios.get(`/api/master/getGender`);
            const response2 = await axios.get(`/api/master/getMarry`);
            if (response1.data) {
                setMasterGender(response1.data.data)
            }
            if (response2.data) {
                setMasterMarry(response2.data.data)
            }
        } catch (error) {
            setAlert({ 
                show: true, 
                message: 'ไม่สามารถดึงข้อมูล Master ได้',
                showClose: true,
                autoCloseMs: undefined,
                messageClassName: undefined
            })
        }
    }

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

    const handleUseCaregiverAddress = async (shouldUseSame: boolean) => {
        setSameAddress(shouldUseSame);

        if (!shouldUseSame) {
            setValue('takecare_number', '', { shouldValidate: true });
            setValue('takecare_moo', '', { shouldValidate: true });
            setValue('takecare_road', '', { shouldValidate: true });
            setValue('takecare_province', '', { shouldValidate: true });
            setValue('takecare_amphur', '', { shouldValidate: true });
            setValue('takecare_tubon', '', { shouldValidate: true });
            setValue('takecare_postcode', '', { shouldValidate: true });
            actions.reset();
            return;
        }

        if (!dataUser.users_id) {
            setAlert({ show: true, message: 'ไม่พบข้อมูลผู้ใช้', showClose: true, autoCloseMs: undefined, messageClassName: undefined });
            setSameAddress(false);
            return;
        }

        setIsLoadingCaregiverAddress(true);
        try {
            const encodedUsersId = encrypt(dataUser.users_id.toString());
            const response = await axios.get(`/api/user/getUserCaregiver/${encodedUsersId}`);
            const caregiver = response.data?.data;
            if (caregiver) {
                setValue('takecare_number', caregiver.takecare_number || '', { shouldValidate: true });
                setValue('takecare_moo', caregiver.takecare_moo || '', { shouldValidate: true });
                setValue('takecare_road', caregiver.takecare_road || '', { shouldValidate: true });
                setValue('takecare_province', caregiver.takecare_province || '', { shouldValidate: true });
                setValue('takecare_amphur', caregiver.takecare_amphur || '', { shouldValidate: true });
                setValue('takecare_tubon', caregiver.takecare_tubon || '', { shouldValidate: true });
                setValue('takecare_postcode', caregiver.takecare_postcode || '', { shouldValidate: true });

                actions.setInitialValues(
                    caregiver.takecare_province || '',
                    caregiver.takecare_amphur || '',
                    caregiver.takecare_tubon || '',
                    caregiver.takecare_postcode || ''
                );
            } else {
                setAlert({ show: true, message: 'ไม่พบข้อมูลที่อยู่ของผู้ดูแล', showClose: true, autoCloseMs: undefined, messageClassName: undefined });
                setSameAddress(false);
            }
        } catch (error) {
            setAlert({ show: true, message: 'เกิดข้อผิดพลาดขณะดึงข้อมูลที่อยู่', showClose: true, autoCloseMs: undefined, messageClassName: undefined });
            setSameAddress(false);
        } finally {
            setIsLoadingCaregiverAddress(false);
        }
    }

    const onSubmit = async (formData: ElderlyRegistrationFormData) => {
        if (!dataUser.users_id) {
            setAlert({ 
                show: true, 
                message: 'ไม่พบข้อมูลผู้ใช้',
                showClose: true,
                autoCloseMs: undefined,
                messageClassName: undefined
            })
            throw new Error('ไม่พบข้อมูลผู้ใช้');
        }
        
        try {
            const data = {
                users_id         : dataUser.users_id,
                takecare_fname   : formData.takecare_fname,
                takecare_sname   : formData.takecare_sname,
                takecare_birthday: formData.takecare_birthday,
                gender_id        : formData.gender_id,
                marry_id         : formData.marry_id,
                takecare_number  : formData.takecare_number,
                takecare_moo     : formData.takecare_moo,
                takecare_road    : formData.takecare_road,
                takecare_tubon   : formData.takecare_tubon,
                takecare_amphur  : formData.takecare_amphur,
                takecare_province: formData.takecare_province,
                takecare_postcode: formData.takecare_postcode,
                takecare_tel1    : formData.takecare_tel1,
                takecare_tel_home: formData.takecare_tel_home,
                takecare_disease : formData.takecare_disease,
                takecare_drug    : formData.takecare_drug,
            }

            await axios.post(`/api/registration/takecareperson`, data)

        } catch (error) {
            setAlert({ 
                show: true, 
                message: 'ไม่สามารถบันทึกข้อมูลได้',
                showClose: true,
                autoCloseMs: undefined,
                messageClassName: undefined
            })
            throw error;
        }
    };

    const onConfirmSubmit = async () => {
        if (!pendingData) return;
        setIsSaving(true);
        try {
            await onSubmit(pendingData);
            
            if (router.query.auToken && typeof router.query.auToken === 'string') {
                try {
                    const responseUser = await axios.get(`/api/user/getUser/${router.query.auToken}`);
                    if (responseUser.data?.data) {
                        const encodedUsersId = encrypt(responseUser.data?.data.users_id.toString());
                        const responseTakecareperson = await axios.get(`/api/user/getUserTakecareperson/${encodedUsersId}`);
                        setDataUser({ 
                            isLogin: false, 
                            data: responseTakecareperson.data?.data, 
                            users_id: responseUser.data?.data.users_id 
                        });
                    }
                } catch (error) {
                    // ไม่ขัดขวาง Alert
                }
            }
            
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

    const onPrepareSubmit = (formData: ElderlyRegistrationFormData) => {
        setPendingData(formData);
        setConfirmShow(true);
    };

    if (dataUser.isLogin) return null;

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
                <div>
                    <span className="profile-badge">AFE PLUS</span>
                </div>
                <h1>ลงทะเบียนผู้มีภาวะพึ่งพิง</h1>
                <p>กรุณากรอกข้อมูลผู้มีภาวะพึ่งพิงให้ครบถ้วนเพื่อลงทะเบียนเข้าสู่ระบบ</p>
            </div>

            <div className="profile-form">
                <Form noValidate onSubmit={handleSubmit(onPrepareSubmit)}>
                    
                    {/* ================= Section 1: ข้อมูลส่วนตัว ================= */}
                    <section className="form-card">
                        <div className="card-header">
                            <div className="step-number">1</div>
                            <div>
                                <h2>ข้อมูลส่วนตัว</h2>
                                <p>ข้อมูลพื้นฐานของผู้มีภาวะพึ่งพิง</p>
                            </div>
                        </div>

                        <div className="form-grid">
                            <InputLabel 
                                label="ชื่อ" 
                                id="takecare_fname" 
                                placeholder="กรอกชื่อ" 
                                disabled={!!dataUser.data}
                                {...register("takecare_fname")}
                                isInvalid={!!errors.takecare_fname}
                                errorMessage={errors.takecare_fname?.message}
                                isValid={isFieldValid("takecare_fname")}
                                required
                            />

                            <InputLabel 
                                label="นามสกุล" 
                                id="takecare_sname" 
                                placeholder="กรอกนามสกุล" 
                                disabled={!!dataUser.data}
                                {...register("takecare_sname")}
                                isInvalid={!!errors.takecare_sname}
                                errorMessage={errors.takecare_sname?.message}
                                isValid={isFieldValid("takecare_sname")}
                                required
                            />
                        </div>

                        <div className="form-grid">
                            <Form.Group className="mb-0">
                                <Form.Label className="mb-1">วันเดือนปีเกิด <span className="text-danger">*</span></Form.Label>
                                <Controller
                                    name="takecare_birthday"
                                    control={control}
                                    render={({ field }) => (
                                        <DatePickerX 
                                            selected={field.value} 
                                            onChange={(date) => field.onChange(date)} 
                                            disabled={!!dataUser.data} 
                                        />
                                    )}
                                />
                                {errors.takecare_birthday && (
                                    <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
                                        {errors.takecare_birthday.message}
                                    </Form.Control.Feedback>
                                )}
                            </Form.Group>

                            <Form.Group className="mb-0">
                                <Form.Label className="mb-1">เพศ <span className="text-danger">*</span></Form.Label>
                                <div className="d-flex justify-content-around mt-2">
                                    {
                                        masterGender.length > 0 && masterGender.map((item: any) => {
                                            const genderId = Number(item.gender_id);
                                            return (
                                                <Form.Check
                                                    key={`gender-${genderId}`}
                                                    label={item.gender_describe}
                                                    type="radio"
                                                    name="gender_id"
                                                    id={`gender-${genderId}`}
                                                    value={genderId}
                                                    disabled={!!dataUser.data}
                                                    checked={watch("gender_id") === genderId}
                                                    onChange={(e) => {
                                                        setValue("gender_id", Number(e.target.value), { shouldValidate: true });
                                                    }}
                                                />
                                            )
                                        })
                                    }
                                </div>
                                {errors.gender_id && (
                                    <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
                                        {errors.gender_id.message}
                                    </Form.Control.Feedback>
                                )}
                            </Form.Group>
                        </div>

                        <div className="form-row-full mt-3">
                            <Form.Group className="mb-0">
                                <Form.Label className="mb-1">สถานะการสมรส <span className="text-danger">*</span></Form.Label>
                                <div className="d-flex flex-wrap gap-4 px-2 mt-1">
                                    {
                                        masterMarry.length > 0 && masterMarry.map((item: any) => {
                                            const marryId = Number(item.marry_id);
                                            return (
                                                <Form.Check
                                                    key={`marry-${marryId}`}
                                                    label={item.marry_describe}
                                                    type="radio"
                                                    name="marry_id"
                                                    id={`marry-${marryId}`}
                                                    value={marryId}
                                                    disabled={!!dataUser.data}
                                                    checked={watch("marry_id") === marryId}
                                                    onChange={(e) => {
                                                        setValue("marry_id", Number(e.target.value), { shouldValidate: true });
                                                    }}
                                                />
                                            )
                                        })
                                    }
                                </div>
                                {errors.marry_id && (
                                    <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
                                        {errors.marry_id.message}
                                    </Form.Control.Feedback>
                                )}
                            </Form.Group>
                        </div>
                    </section>


                    {/* ================= Section 2: ข้อมูลที่อยู่ ================= */}
                    <section className="form-card">
                        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
                            <div className="d-flex align-items-center gap-3">
                                <div className="step-number">2</div>
                                <div>
                                    <h2>ข้อมูลที่อยู่</h2>
                                    <p>กรุณาระบุที่อยู่ปัจจุบันของผู้มีภาวะพึ่งพิง</p>
                                </div>
                            </div>
                            
                            {/* Checkbox เลือกใช้ที่อยู่เดียวกับผู้ดูแล */}
                            {!dataUser.data && (
                                <div className="same-address-wrapper">
                                    <Form.Check 
                                        type="switch"
                                        id="same-address-switch"
                                        label={isLoadingCaregiverAddress ? "กำลังดึงข้อมูลที่อยู่..." : "ใช้ที่อยู่เดียวกับผู้ดูแล"}
                                        checked={sameAddress}
                                        disabled={isLoadingCaregiverAddress}
                                        onChange={(e) => handleUseCaregiverAddress(e.target.checked)}
                                        className="fw-medium text-success fs-6"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="form-grid">
                            <InputLabel 
                                label="เลขที่บ้าน" 
                                id="takecare_number" 
                                placeholder="เช่น 123/12" 
                                max={10}
                                disabled={!!dataUser.data || sameAddress}
                                {...register("takecare_number")}
                                isValid={isFieldValid("takecare_number")}
                            />

                            <InputLabel 
                                label="หมู่" 
                                id="takecare_moo" 
                                placeholder="เช่น 1" 
                                max={5}
                                disabled={!!dataUser.data || sameAddress}
                                {...register("takecare_moo")}
                                numericOnly
                                isValid={isFieldValid("takecare_moo")}
                            />
                        </div>

                        <div className="form-row-full">
                            <InputLabel 
                                label="ถนน" 
                                id="takecare_road" 
                                placeholder="กรอกชื่อถนน" 
                                disabled={!!dataUser.data || sameAddress}
                                {...register("takecare_road")}
                                isValid={isFieldValid("takecare_road")}
                            />
                        </div>

                        {status.loading ? (
                            <div className="loading-address">กำลังโหลดข้อมูลจังหวัด...</div>
                        ) : (
                            <>
                                <input type="hidden" {...register("takecare_province")} />
                                <input type="hidden" {...register("takecare_amphur")} />
                                <input type="hidden" {...register("takecare_tubon")} />
                                
                                <div className="form-grid">
                                    <SelectAddress
                                        label="จังหวัด"
                                        id="takecare_province"
                                        value={selected.provinceId}
                                        options={data.provinces}
                                        onChange={actions.setProvince}
                                        disabled={!!dataUser.data || status.loading || !status.error || sameAddress}
                                        placeholder="เลือกจังหวัด"
                                        isInvalid={!!errors.takecare_province}
                                        errorMessage={errors.takecare_province?.message}
                                        isValid={isFieldValid("takecare_province")}
                                        required
                                        getLabel={getLabel}
                                    />

                                    <SelectAddress
                                        label="อำเภอ"
                                        id="takecare_amphur"
                                        value={selected.districtId}
                                        options={data.districts}
                                        onChange={actions.setDistrict}
                                        disabled={!!dataUser.data || !selected.provinceId || sameAddress}
                                        placeholder={!selected.provinceId ? "เลือกจังหวัดก่อน" : "เลือกอำเภอ"}
                                        isInvalid={!!errors.takecare_amphur}
                                        errorMessage={errors.takecare_amphur?.message}
                                        isValid={isFieldValid("takecare_amphur")}
                                        required
                                        getLabel={getLabel}
                                    />
                                </div>

                                <div className="form-grid">
                                    <SelectAddress
                                        label="ตำบล"
                                        id="takecare_tubon"
                                        value={selected.subDistrictId}
                                        options={data.subDistricts}
                                        onChange={actions.setSubDistrict}
                                        disabled={!!dataUser.data || !selected.districtId || sameAddress}
                                        placeholder={!selected.districtId ? "เลือกอำเภอก่อน" : "เลือกตำบล"}
                                        isInvalid={!!errors.takecare_tubon}
                                        errorMessage={errors.takecare_tubon?.message}
                                        isValid={isFieldValid("takecare_tubon")}
                                        required
                                        getLabel={getLabel}
                                    />

                                    <InputLabel 
                                        label="รหัสไปรษณีย์" 
                                        id="takecare_postcode" 
                                        placeholder="รหัสไปรษณีย์จะถูกกรอกอัตโนมัติ" 
                                        type="tel"
                                        max={5}
                                        disabled={!!dataUser.data}
                                        {...register("takecare_postcode")}
                                        isInvalid={!!errors.takecare_postcode}
                                        isValid={isFieldValid("takecare_postcode")}
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
                                <p>ช่องทางสำหรับติดต่อผู้มีภาวะพึ่งพิง</p>
                            </div>
                        </div>

                        <div className="form-grid">
                            <InputLabel 
                                label="เบอร์โทรศัพท์มือถือ" 
                                id="takecare_tel1" 
                                placeholder="08XXXXXXXX" 
                                type="tel"
                                max={10}
                                disabled={!!dataUser.data}
                                {...register("takecare_tel1")}
                                isValid={isFieldValid("takecare_tel1")}
                            />

                            <InputLabel 
                                label="เบอร์โทรศัพท์บ้าน" 
                                id="takecare_tel_home" 
                                placeholder="กรอกเบอร์โทรศัพท์บ้าน (ถ้ามี)" 
                                type="tel"
                                max={10}
                                disabled={!!dataUser.data}
                                {...register("takecare_tel_home")}
                                isInvalid={!!errors.takecare_tel_home}
                                errorMessage={errors.takecare_tel_home?.message}
                                isValid={isFieldValid("takecare_tel_home")}
                            />
                        </div>
                    </section>


                    {/* ================= Section 4: ข้อมูลสุขภาพ ================= */}
                    <section className="form-card">
                        <div className="card-header">
                            <div className="step-number">4</div>
                            <div>
                                <h2>ข้อมูลสุขภาพ</h2>
                                <p>ข้อมูลโรคประจำตัวและยาที่ใช้เป็นประจำ</p>
                            </div>
                        </div>

                        <div className="form-row-full mb-3">
                            <Controller
                                name="takecare_disease"
                                control={control}
                                render={({ field }) => (
                                    <ChronicDiseaseSelect
                                        initialValue={field.value || ""}
                                        onChange={(value) => {
                                            field.onChange(value);
                                        }}
                                        label="โรคประจำตัว"
                                        placeholder="กรอกโรคประจำตัว"
                                    />
                                )}
                            />
                            {errors.takecare_disease && (
                                <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
                                    {errors.takecare_disease.message}
                                </Form.Control.Feedback>
                            )}
                        </div>

                        <div className="form-row-full mb-0">
                            <InputLabel 
                                label="ยาที่ใช้ประจำ" 
                                id="takecare_drug" 
                                placeholder="กรอกยาที่ใช้ประจำ"
                                disabled={!!dataUser.data}
                                {...register("takecare_drug")}
                                isValid={isFieldValid("takecare_drug")}
                            />
                        </div>
                    </section>


                    {/* ================= ปุ่มบันทึก ================= */}
                    {
                        !dataUser.data && (
                            <div className="submit-section">
                                <ButtonState 
                                    type="submit" 
                                    className="submit-button" 
                                    text={'บันทึกข้อมูล'} 
                                    icon="fas fa-save" 
                                    isLoading={isSaving} 
                                />
                            </div>
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
                   Profile / Registration Styles
                ================================ */
                .profile-container {
                    max-width: 850px;
                    padding: 25px 15px 70px;
                }

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

                .form-card {
                    background: #ffffff;
                    border: 1px solid #e8e8e8;
                    border-radius: 16px;
                    padding: 30px;
                    margin-bottom: 25px;
                    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.05);
                }

                .card-header {
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

                .same-address-wrapper {
                    background: #f0fdf4;
                    padding: 6px 14px;
                    border-radius: 20px;
                    border: 1px solid #bbf7d0;
                }

                .form-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 20px;
                    margin-bottom: 20px;
                }

                .form-row-full {
                    width: 100%;
                    margin-bottom: 20px;
                }

                .loading-address {
                    padding: 20px;
                    text-align: center;
                    border-radius: 10px;
                    background: #f5f5f5;
                    color: #777;
                }

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

                @media (max-width: 600px) {
                    .profile-container {
                        padding: 20px 10px 50px;
                    }
                    .profile-header h1 {
                        font-size: 1.7rem;
                    }
                    .form-card {
                        padding: 20px 16px;
                        border-radius: 12px;
                    }
                    .card-header {
                        margin-bottom: 20px;
                        flex-direction: column;
                        align-items: flex-start !important;
                        gap: 12px;
                    }
                    .same-address-wrapper {
                        width: 100%;
                    }
                    .form-grid {
                        grid-template-columns: 1fr;
                        gap: 16px;
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
    title: 'ลงทะเบียนผู้มีภาวะพึ่งพิง',
    description: 'ลงทะเบียนผู้มีภาวะพึ่งพิง',
    slug: '',
    titleBar: 'ลงทะเบียนผู้มีภาวะพึ่งพิง'
});

export default ElderlyRegistration