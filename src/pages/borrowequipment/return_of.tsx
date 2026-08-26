import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useRouter } from 'next/router';

import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Toast from 'react-bootstrap/Toast';
import Button from 'react-bootstrap/Button';

import styles from '@/styles/page.module.css';

interface BorrowedItemType {
  borrow_equipment_id: number;
  equipment_name: string;
  equipment_code: string;
  startDate: string;
  endDate: string;
}

interface UserType {
  users_id: number;
}

const ReturnOf = () => {
  const router = useRouter();
  const [user, setUser] = useState<UserType | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [borrowedItems, setBorrowedItems] = useState<BorrowedItemType[]>([]);
  const [returnList, setReturnList] = useState<number[]>([]); // เก็บ ID ของอุปกรณ์ที่ต้องการคืน
  const [alert, setAlert] = useState({ show: false, message: '' });

  // ดึงข้อมูลผู้ใช้ด้วย auToken
  const fetchUserData = async () => {
    try {
      const auToken = router.query.auToken;
      if (auToken) {
        const responseUser = await axios.get(`/api/user/getUser/${auToken}`);
        if (responseUser.data?.data) {
          setUser(responseUser.data.data);
        } else {
          setAlert({ show: true, message: 'ไม่สามารถโหลดข้อมูลผู้ใช้ได้' });
        }
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
      setAlert({ show: true, message: 'ไม่สามารถโหลดข้อมูลผู้ใช้ได้' });
    }
  };

  // ดึงข้อมูลรายการอุปกรณ์ที่ถูกยืมของผู้ใช้ที่ล็อกอินอยู่
  const fetchBorrowedItems = async (userId: number) => {
    try {
      setLoading(true);
      const response = await axios.get(`/api/borrowequipment/list?userId=${userId}`);
      if (response.data?.data) {
        const borrowedData: BorrowedItemType[] = response.data.data.flatMap((item: any) =>
          item.borrowequipment_list.map((eq: any) => ({
            borrow_equipment_id: eq.borrow_equipment_id,
            equipment_name: eq.equipment?.equipment_name || "ไม่พบข้อมูล",
            equipment_code: eq.equipment?.equipment_code || "ไม่พบข้อมูล",
            startDate: item.borrow_date ? new Date(item.borrow_date).toISOString().split('T')[0] : "",
            endDate: item.borrow_return ? new Date(item.borrow_return).toISOString().split('T')[0] : "",
          }))
        );
        setBorrowedItems(borrowedData);
      }
    } catch (error) {
      console.error('Error fetching borrowed equipment:', error);
      setAlert({ show: true, message: 'ไม่สามารถโหลดรายการอุปกรณ์ที่ถูกยืมได้' });
    } finally {
      setLoading(false);
    }
  };

  // ดึงข้อมูลผู้ใช้เมื่อ auToken พร้อมใช้งาน
  useEffect(() => {
    if (router.query.auToken) {
      fetchUserData();
    }
  }, [router.query.auToken]);

  // เมื่อผู้ใช้ถูกโหลดแล้ว ให้ดึงข้อมูลรายการยืมโดยใช้ userId
  useEffect(() => {
    if (user) {
      fetchBorrowedItems(user.users_id);
    }
  }, [user]);

  // ฟังก์ชันลบรายการอุปกรณ์ออกจาก UI (ถือว่าอุปกรณ์ถูกคืน)
  const removeItem = (index: number, id: number) => {
    setReturnList([...returnList, id]);
    setBorrowedItems(borrowedItems.filter((_, i) => i !== index));
  };

  // ฟังก์ชันบันทึกการคืนอุปกรณ์
  const handleReturnSubmit = async () => {
    if (returnList.length === 0) {
      setAlert({ show: true, message: 'กรุณาเลือกรายการที่ต้องการคืน' });
      return;
    }

    try {
      setLoading(true);
      await axios.post(`/api/borrowequipment/return`, {
        returnList,
      });
      setAlert({ show: true, message: 'คืนอุปกรณ์สำเร็จแล้ว' });
      setReturnList([]);
      if (user) {
        fetchBorrowedItems(user.users_id); // โหลดข้อมูลใหม่หลังคืนอุปกรณ์
      }
    } catch (error) {
      console.error('Error returning equipment:', error);
      setAlert({ show: true, message: 'เกิดข้อผิดพลาดในการคืนอุปกรณ์' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container>
      <div className={styles.main}>
        <h1 className="py-2">คืนอุปกรณ์ครุภัณฑ์</h1>
      </div>
      <div className="px-5">
        <Form noValidate>
          <Form.Group className="py-2">
            {isLoading ? (
              <p>กำลังโหลด...</p>
            ) : borrowedItems.length > 0 ? (
              borrowedItems.map((item, index) => (
                <Toast key={index} onClose={() => removeItem(index, item.borrow_equipment_id)} className="mb-2">
                  <Toast.Header>
                    <strong className="me-auto">{item.equipment_name}</strong>
                  </Toast.Header>
                  <Toast.Body>
                    <div>
                      <span style={{ fontWeight: 'bold' }}>หมายเลขอุปกรณ์: {item.equipment_code}</span>
                    </div>
                    <div className={styles.toastDate}>
                      <span>เริ่ม {item.startDate}</span>
                      {/* <span>สิ้นสุด {item.endDate}</span> */}
                    </div>
                  </Toast.Body>
                </Toast>
              ))
            ) : (
              <p>ไม่มีอุปกรณ์ที่ถูกยืม</p>
            )}
          </Form.Group>
          <Button variant="primary" onClick={handleReturnSubmit} disabled={returnList.length === 0}>
            {isLoading ? 'กำลังบันทึก...' : 'บันทึกการคืน'}
          </Button>
        </Form>
      </div>
    </Container>
  );
};

export default ReturnOf;
