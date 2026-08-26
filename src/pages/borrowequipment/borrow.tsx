import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useRouter } from 'next/router';

import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Col from 'react-bootstrap/Col';
import Toast from 'react-bootstrap/Toast';

import InputLabel from '@/components/Form/InputLabel';
import TextareaLabel from '@/components/Form/TextareaLabel';
import ModalAlert from '@/components/Modals/ModalAlert';
import ModalActions from '@/components/Modals/ModalActions';
import ButtonState from '@/components/Button/ButtonState';
import ButtonAdd from '@/components/Button/ButtonAdd';
import DatePickerX from '@/components/DatePicker/DatePickerX';
import { encrypt } from '@/utils/helpers'
import styles from '@/styles/page.module.css';

interface EquipmentType {
    equipment_id: number;
    equipment_name: string;
    equipment_code: string;
}

const Borrow = () => {
    const router = useRouter();
    const inputRef = useRef<HTMLFormElement>(null);

    const [validated, setValidated] = useState(false);
    const [validatedModal, setValidatedModal] = useState(false);
    const [alert, setAlert] = useState({ show: false, message: '' });
    const [isLoading, setLoading] = useState(false);
    const [startDate, setStartDate] = useState<Date | null>(new Date());
    const [endDate, setEndDate] = useState<Date | null>(new Date());
    const [modalSave, setModalSave] = useState(false);

    const [user, setUser] = useState<any>(null);
    const [availableEquipment, setAvailableEquipment] = useState<EquipmentType[]>([]);
    const [selectedEquipment, setSelectedEquipment] = useState<EquipmentType | null>(null);
    const [listItem, setListItem] = useState<EquipmentType[]>([]);
    const [carePerson, setCarePerson] = useState<any>(null);

    // โหลดรายการอุปกรณ์ครั้งเดียวเมื่อ component mount
    useEffect(() => {
        fetchAvailableEquipment();
    }, []);

    // โหลดข้อมูลผู้ใช้เมื่อค่า auToken พร้อมใช้งาน
    useEffect(() => {
        if (router.query.auToken) {
            fetchUserData();
        }
    }, [router.query.auToken]);

    const fetchAvailableEquipment = async () => {
        try {
            const response = await axios.get(`/api/borrowequipment/getAvailableEquipment`);
            if (response.data?.data) {
                setAvailableEquipment(response.data.data);
            }
        } catch (error) {
            console.error("Error fetching available equipment:", error);
            setAlert({ show: true, message: 'ไม่สามารถโหลดรายการอุปกรณ์ได้' });
        }
    };

    const fetchUserData = async () => {
        try {
            const auToken = router.query.auToken;
            if (auToken) {
                const responseUser = await axios.get(`/api/user/getUser/${auToken}`);
                if (responseUser.data?.data) {
                    setUser(responseUser.data.data);
                    const encodedUsersId = encrypt(responseUser.data?.data.users_id.toString());
                    // ดึงข้อมูลผูู้มีภาวะพพึ่งพิงจากผู้ดูแล
                    const responseTakecareperson = await axios.get(`/api/user/getUserTakecareperson/${encodedUsersId}`);
                    const data = responseTakecareperson.data?.data;
                    if (data) {
                        setCarePerson(data);  // เก็บข้อมูลผู้มีภาวะพึ่งพิงที่ดูแล
                    }
                } else {
                    setAlert({ show: true, message: 'ไม่สามารถโหลดข้อมูลผู้ใช้ได้' });
                }
            }
        } catch (error) {
            console.error("Error fetching user data:", error);
            setAlert({ show: true, message: 'ไม่สามารถโหลดข้อมูลผู้ใช้ได้' });
        }
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        event.stopPropagation();

        // ตรวจสอบว่ามีการเพิ่มอุปกรณ์และข้อมูลผู้ใช้ถูกโหลดแล้ว
        if (!listItem.length || !user || !carePerson) {
            setAlert({ show: true, message: 'กรุณาเลือกอุปกรณ์และกรอกข้อมูลให้ครบถ้วน' });
            return;
        }

        setLoading(true);

        try {
            const data = {
                borrow_date: startDate,
                borrow_return: endDate,
                borrow_status: 1,
                borrow_user_id: user.users_id,
                borrow_address: event.currentTarget['borrow_address'].value,
                borrow_tel: event.currentTarget['borrow_tel'].value,
                borrow_objective: event.currentTarget['borrow_objective'].value,
                borrow_name: event.currentTarget['borrow_name'].value, // เก็บชื่อผู้มีภาวะพึ่งพิง
                borrow_list: listItem.map(item => ({ equipment_id: item.equipment_id }))
            };

            await axios.post(`/api/borrowequipment/create`, data);
            setAlert({ show: true, message: 'บันทึกข้อมูลสำเร็จ' });
        } catch (error) {
            setAlert({ show: true, message: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง' });
        } finally {
            setLoading(false);
            setValidated(true);
        }
    };

    const handleAddEquipment = () => {
        if (selectedEquipment && !listItem.some(item => item.equipment_id === selectedEquipment.equipment_id)) {
            setListItem([...listItem, selectedEquipment]);
            setModalSave(false);
        } else {
            setValidatedModal(true);
        }
    };

    const removeItem = (index: number) => {
        setListItem(listItem.filter((_, i) => i !== index));
    };

    return (
        <Container>
            <div className={styles.main}>
                <h1 className="py-2">ยืมอุปกรณ์ครุภัณฑ์</h1>
            </div>
            <div className="px-5">
                <Form noValidate validated={validated} onSubmit={handleSubmit}>
                    {/* ชื่อผู้ดูแล */}
                    <Form.Group>
                        <Form.Label>ชื่อผู้ดูแล</Form.Label>
                        <Form.Control
                            value={user ? `${user.users_fname} ${user.users_sname}` : ''}
                            readOnly
                            disabled
                        />
                    </Form.Group>

                    {/* ชื่อผู้มีภาวะพึ่งพิง */}
                    <Form.Group>
                        <Form.Label>ชื่อผู้มีภาวะพึ่งพิง</Form.Label>
                        <Form.Control
                            value={carePerson ? `${carePerson.takecare_fname} ${carePerson.takecare_sname}` : ''}
                            disabled
                            readOnly
                        />
                        <Form.Control
                            type="hidden"
                            id="borrow_name"
                            name="borrow_name"
                            value={carePerson ? `${carePerson.takecare_fname} ${carePerson.takecare_sname}` : ''}
                        />
                    </Form.Group>
                    
                    
{/* ที่อยู่ผู้ดูแล */}
<Form.Group>
    <Form.Label>ที่อยู่</Form.Label>
    <Form.Control
        as="textarea"
        rows={2}
        disabled
        value={
            carePerson
                ? `${carePerson.takecare_number ?? ''} หมู่ ${carePerson.takecare_moo ?? ''} `
                  + `${carePerson.takecare_road ?? ''} `
                  + `ตำบล.${carePerson.takecare_tubon ?? ''} `
                  + `อำเภอ.${carePerson.takecare_amphur ?? ''} `
                  + `จังหวัด.${carePerson.takecare_province ?? ''} `
                  + `${carePerson.takecare_postcode ?? ''}`
                : ''
        }
    />
    <Form.Control
        type="hidden"
        id="borrow_address"
        name="borrow_address"
        value={
            carePerson
                ? `${carePerson.takecare_number ?? ''} หมู่ ${carePerson.takecare_moo ?? ''} `
                  + `${carePerson.takecare_road ?? ''} `
                  + `ตำบล.${carePerson.takecare_tubon ?? ''} `
                  + `อำเภอ.${carePerson.takecare_amphur ?? ''} `
                  + `จังหวัด.${carePerson.takecare_province ?? ''} `
                  + `${carePerson.takecare_postcode ?? ''}`
                : ''
        }
    />
</Form.Group>

{/* เบอร์โทรผู้มีภาวะพึ่งพิง */}
<Form.Group>
    <Form.Label>เบอร์โทร</Form.Label>
    <Form.Control
        type="text"
        disabled
        value={user?.users_tel1 ?? ''}
    />
    <Form.Control
        type="hidden"
        id="borrow_tel"
        name="borrow_tel"
        value={user?.users_tel1 ?? ''}
    />
</Form.Group>
                    {/* ที่อยู่และเบอร์โทร */}
                    {/* <TextareaLabel label='ที่อยู่' id="borrow_address" required />
                    <InputLabel label='หมายเลขโทรศัพท์' id="borrow_tel" required /> */}
                    <InputLabel label='เหตุผล (ระบุลักษณะอาการหรือข้อจำกัดที่ส่งผลต่อการดำเนินชีวิตของผู้มีภาวะพึ่งพิง เช่น ภาวะหลงลืม เดินหลงทาง ข้อจำกัดในการดูแลตนเอง หรือเคลื่อนไหวลำบาก)' id="borrow_objective" required />
                    
                    <p className="m-0">วันเดือนปี (ยื่นคำขอ)</p>
                    <DatePickerX selected={startDate} onChange={setStartDate} />

                    {/* <p className="m-0">วันเดือนปี (สิ้นสุด)</p>
                    <DatePickerX selected={endDate} onChange={setEndDate} /> */}

                    <Form.Group className="py-2">
                        {listItem.length > 0 && listItem.map((item, index) => (
                            <Toast key={index} onClose={() => removeItem(index)} className="mb-2">
                                <Toast.Header>
                                    <strong className="me-auto">{item.equipment_name}</strong>
                                </Toast.Header>
                                <Toast.Body>{item.equipment_code}</Toast.Body>
                            </Toast>
                        ))}
                        <Col sm={2}>
                            <ButtonAdd onClick={() => setModalSave(true)} title='เพิ่มข้อมูลอุปกรณ์' />
                        </Col>
                    </Form.Group>

                    <Form.Group className="d-flex justify-content-center py-3">
                        <ButtonState type="submit" text={'บันทึก'} isLoading={isLoading} />
                    </Form.Group>
                </Form>
            </div>

            <ModalAlert show={alert.show} message={alert.message} handleClose={() => setAlert({ show: false, message: '' })} />
            
            <ModalActions show={modalSave} title='เพิ่มข้อมูลอุปกรณ์' onClick={handleAddEquipment} onHide={() => setModalSave(false)}>
                <Form noValidate validated={validatedModal}>
                    <Form.Group>
                        <Form.Label>เลือกอุปกรณ์</Form.Label>
                        <Form.Select onChange={(e) => {
                            const selected = availableEquipment.find(eq => eq.equipment_id === Number(e.target.value));
                            if (selected) setSelectedEquipment(selected);
                        }}>
                            <option value="">-- เลือกอุปกรณ์ --</option>
                            {availableEquipment.map(e => (
                                <option key={e.equipment_id} value={e.equipment_id}>
                                    {e.equipment_name} - {e.equipment_code}
                                </option>
                            ))}
                        </Form.Select>
                    </Form.Group>
                </Form>
            </ModalActions>
        </Container>
    );
};

export default Borrow;
