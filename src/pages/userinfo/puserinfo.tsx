'use client'
import React, { useState, useEffect } from 'react'
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
import DatePickerX from '@/components/DatePicker/DatePickerX';
import ChronicDiseaseSelect from '@/components/Form/ChronicDiseaseSelect';

// 🔥 Import Validation
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { puserinfoSchema, PuserinfoFormData } from '@/components/validations/puserinfoSchema';

// 🔥 Import Hook
import { useThaiAddress } from '@/hooks/useThaiAddress';
import { encrypt } from '@/utils/helpers'

interface UserData {
    isLogin: boolean;
    data   : UserDataProps | null;
}

interface UserTakecareData {
    isLogin : boolean;
    data    : UserTakecareProps | null;
    users_id: number | null;
}

const Puserinfo = () => {
    const router = useRouter();
    const [alert, setAlert] = useState({
        show: false,
        message: '',
        showClose: true,
        autoCloseMs: undefined as number | undefined,
        messageClassName: undefined as string | undefined
    });
    const [user, setUser] = useState<UserData>({ isLogin: false, data: null })
    const [dataUser, setDataUser] = useState<UserTakecareData>({ isLogin: true, data: null, users_id: null });
    const [masterGender, setMasterGender] = useState<[]>([]);
    const [masterMarry, setMasterMarry] = useState<[]>([]);
    const [confirmShow, setConfirmShow] = useState(false);
    const [pendingData, setPendingData] = useState<PuserinfoFormData | null>(null);
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
        control,
        formState: { errors, dirtyFields } // 🔥 เพิ่ม dirtyFields
    } = useForm<PuserinfoFormData>({
        resolver: zodResolver(puserinfoSchema),
        mode: "onChange",
    });

    // ❌ ลบ useEffect ที่ใช้ Sync ค่าเดิมออกแล้ว

    // 🔥 ฟังก์ชันเช็คว่าควรขึ้น "สีเขียว" หรือไม่ (รวมเช็ค Date/Number และ Dirty)
    const isFieldValid = (name: keyof PuserinfoFormData) => {
        const value = watch(name);
        const hasError = !!errors[name];
        const isDirty = dirtyFields[name];

        if (hasError) return false;
        if (!isDirty) return false; // ถ้าไม่ได้แก้ ไม่ต้องเขียว

        if (value === undefined || value === null) return false;
        if (typeof value === 'string' && value.trim() === '') return false;
        
        return true;
    };

    useEffect(() => {
        getMasterData()
        const auToken = router.query.auToken
        
        if (auToken && typeof auToken === 'string') {
            const fetchUserData = async () => {
                try {
                    const responseUser = await axios.get(`/api/user/getUser/${auToken}`);
                    if (responseUser.data?.data) {
                        const encodedUsersId = encrypt(responseUser.data?.data.users_id.toString());
                        const responseTakecareperson = await axios.get(`/api/user/getUserTakecareperson/${encodedUsersId}`);
                    
                        const takecareData = responseTakecareperson.data?.data;
                        
                        if(takecareData){
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
                                takecare_disease: takecareData.takecare_disease || "",
                                takecare_drug: takecareData.takecare_drug,
                            });
                        }
                        
                        setDataUser({ isLogin: false, data: takecareData, users_id: responseUser.data?.data.users_id })
                        setUser({ isLogin: false, data: responseUser.data?.data })
                    } else {
                        setUser({ isLogin: false, data: null })
                        setDataUser({ isLogin: false, data: null, users_id: null })
                    }
                } catch (error) {
                    console.log("🚀 ~ file: Puserinfo.tsx ~ fetchUserData ~ error:", error)
                    setUser({ isLogin: false, data: null })
                    setDataUser({ isLogin: false, data: null, users_id: null })
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
            setAlert({ show: true, message: 'ไม่สามารถดึงข้อมูล Master ได้', showClose: true, autoCloseMs: undefined, messageClassName: undefined })
        }
    }

    const onSubmit = async (formData: PuserinfoFormData) => {
        if(!dataUser.data){
            setAlert({ show: true, message: 'ไม่พบข้อมูลผู้มีภาวะพึ่งพิง', showClose: true, autoCloseMs: undefined, messageClassName: undefined })
            throw new Error('ไม่พบข้อมูลผู้มีภาวะพึ่งพิง');
        }
        
        try {

            const data = {
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

            const encodedUsersId = encrypt(dataUser.data.takecare_id.toString());
            await axios.post(`/api/user/updateUserTakecare/${encodedUsersId}`, data)
            
            if (router.query.auToken && typeof router.query.auToken === 'string') {
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

    const onPrepareSubmit = (formData: PuserinfoFormData) => {
        setPendingData(formData);
        setConfirmShow(true);
    };

//if (dataUser.isLogin) return <div>loading...</div>;

    return (
        <Container>
            <div className={styles.main}>
                <h1 className="py-2">ข้อมูลผู้มีภาวะพึ่งพิง</h1>
            </div>
            <div className="px-5">
                <Form noValidate onSubmit={handleSubmit(onPrepareSubmit)}>
                    
                    <InputLabel 
                        label="ชื่อ" 
                        id="takecare_fname" 
                        placeholder="กรอกชื่อ" 
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
                        {...register("takecare_sname")}
                        isInvalid={!!errors.takecare_sname}
                        errorMessage={errors.takecare_sname?.message}
                        isValid={isFieldValid("takecare_sname")}
                        required
                    />

                    <Form.Group className="mb-3">
                        <Form.Label>วันเดือนปีเกิด <span className="text-danger">*</span></Form.Label>
                        <Controller
                            name="takecare_birthday"
                            control={control}
                            render={({ field }) => (
                                <DatePickerX 
                                    selected={field.value} 
                                    onChange={(date) => field.onChange(date)} 
                                />
                            )}
                        />
                        {errors.takecare_birthday && (
                            <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
                                {errors.takecare_birthday.message}
                            </Form.Control.Feedback>
                        )}
                    </Form.Group>

                    <Form.Group className="mb-3">
                        <Form.Label>เพศ <span className="text-danger">*</span></Form.Label>
                        <div className="d-flex justify-content-around">
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
                                            checked={watch("gender_id") === genderId}
                                            onChange={(e) => {
                                                setValue("gender_id", Number(e.target.value), { shouldValidate: true, shouldDirty: true });
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

                    <Form.Group className="mb-3">
                        <Form.Label>สถานะการสมรส <span className="text-danger">*</span></Form.Label>
                        <div className="px-4">
                            {
                                masterMarry.length > 0 && masterMarry.map((item: any) => {
                                    const marryId = Number(item.marry_id);
                                    return (
                                        <Form.Check
                                            key={`marry-${marryId}`}
                                            className="py-1"
                                            label={item.marry_describe}
                                            type="radio"
                                            name="marry_id"
                                            id={`marry-${marryId}`}
                                            value={marryId}
                                            checked={watch("marry_id") === marryId}
                                            onChange={(e) => {
                                                setValue("marry_id", Number(e.target.value), { shouldValidate: true, shouldDirty: true });
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

                    <InputLabel 
                        label="เลขที่บ้าน" 
                        id="takecare_number" 
                        placeholder="123/12" 
                        max={10}
                        {...register("takecare_number")}
                        isValid={isFieldValid("takecare_number")}
                    />

                    <InputLabel 
                        label="หมู่" 
                        id="takecare_moo" 
                        placeholder="1"  
                        max={5}
                        {...register("takecare_moo")}
                        numericOnly
                        isValid={isFieldValid("takecare_moo")}
                    />

                    <InputLabel 
                        label="ถนน" 
                        id="takecare_road" 
                        placeholder="-"
                        {...register("takecare_road")}
                        isValid={isFieldValid("takecare_road")}
                    />

                    {/* 🔥 Dropdown สำหรับที่อยู่ (แก้ไขใหม่) */}
                    {status.loading ? (
                        <p className="text-muted">กำลังโหลดข้อมูลจังหวัด...</p>
                    ) : (
                        <>
                            <input type="hidden" {...register("takecare_province")} />
                            <input type="hidden" {...register("takecare_amphur")} />
                            <input type="hidden" {...register("takecare_tubon")} />
                            
                            <SelectAddress
                                label="จังหวัด"
                                id="takecare_province"
                                value={selected.provinceId}
                                options={data.provinces}
                                onChange={(id) => {
                                    actions.setProvince(id); 
                                    const name = getNames.getProvinceName(id);
                                    
                                    setValue("takecare_province", name, { shouldValidate: true, shouldDirty: true });

                                    // ถ้าเปลี่ยนจังหวัด หรือ เลือกค่าว่าง -> ล้างลูกข่ายทั้งหมด
                                    setValue("takecare_amphur", "", { shouldValidate: true, shouldDirty: true });
                                    setValue("takecare_tubon", "", { shouldValidate: true, shouldDirty: true });
                                    setValue("takecare_postcode", "", { shouldValidate: true, shouldDirty: true });
                                }}
                                disabled={status.loading || !!status.error}
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
                                onChange={(id) => {
                                    actions.setDistrict(id);
                                    const name = getNames.getDistrictName(id);
                                    setValue("takecare_amphur", name, { shouldValidate: true, shouldDirty: true });

                                    // ถ้าเปลี่ยนอำเภอ -> ล้างตำบลและไปรษณีย์
                                    setValue("takecare_tubon", "", { shouldValidate: true, shouldDirty: true });
                                    setValue("takecare_postcode", "", { shouldValidate: true, shouldDirty: true });
                                }}
                                disabled={!selected.provinceId}
                                placeholder={!selected.provinceId ? "เลือกจังหวัดก่อน" : "เลือกอำเภอ"}
                                isInvalid={!!errors.takecare_amphur}
                                errorMessage={errors.takecare_amphur?.message}
                                isValid={isFieldValid("takecare_amphur")}
                                required
                                getLabel={getLabel}
                            />

                            <SelectAddress
                                label="ตำบล"
                                id="takecare_tubon"
                                value={selected.subDistrictId}
                                options={data.subDistricts}
                                onChange={(id) => {
                                    actions.setSubDistrict(id);
                                    const name = getNames.getSubDistrictName(id);
                                    setValue("takecare_tubon", name, { shouldValidate: true, shouldDirty: true });

                                    // ดึงรหัสไปรษณีย์ทันที
                                    const subDist = data.subDistricts.find(s => s.id === Number(id));
                                    const zipCode = subDist?.zip_code ? String(subDist.zip_code) : "";
                                    setValue("takecare_postcode", zipCode, { shouldValidate: true, shouldDirty: true });
                                }}
                                disabled={!selected.districtId}
                                placeholder={!selected.districtId ? "เลือกอำเภอก่อน" : "เลือกตำบล"}
                                isInvalid={!!errors.takecare_tubon}
                                errorMessage={errors.takecare_tubon?.message}
                                isValid={isFieldValid("takecare_tubon")}
                                required
                                getLabel={getLabel}
                            />
                        </>
                    )}

                    <InputLabel 
                        label="รหัสไปรษณีย์" 
                        id="takecare_postcode" 
                        placeholder="รหัสไปรษณีย์จะถูกกรอกอัตโนมัติ" 
                        type="tel"
                        max={5}
                        {...register("takecare_postcode")}
                        isInvalid={!!errors.takecare_postcode}
                        isValid={isFieldValid("takecare_postcode")}
                        readOnly
                        required
                    />

                    <InputLabel 
                        label="เบอร์โทรศัพท์มือถือ" 
                        id="takecare_tel1" 
                        placeholder="กรอกเบอร์โทรศัพท์มือถือ" 
                        type="tel"
                        max={10}
                        {...register("takecare_tel1")}
                        isValid={isFieldValid("takecare_tel1")}                        
                    />


                    <InputLabel 
                        label="เบอร์โทรศัพท์บ้าน" 
                        id="takecare_tel_home" 
                        placeholder="กรอกเบอร์โทรศัพท์บ้าน" 
                        type="tel"
                        max={10}
                        {...register("takecare_tel_home")}
                        isInvalid={!!errors.takecare_tel_home}
                        errorMessage={errors.takecare_tel_home?.message}
                        isValid={isFieldValid("takecare_tel_home")}
                    />

                    <Form.Group className="mb-3">
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
                    </Form.Group>

                    <InputLabel 
                        label="ยาที่ใช้ประจำ" 
                        id="takecare_drug" 
                        placeholder="กรอกยาที่ใช้ประจำ"
                        {...register("takecare_drug")}
                        isValid={isFieldValid("takecare_drug")}
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

export default Puserinfo
