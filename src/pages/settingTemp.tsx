'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import axios from 'axios'

import Spinner from 'react-bootstrap/Spinner'
import Container from 'react-bootstrap/Container'
import Row from 'react-bootstrap/Row'
import Col from 'react-bootstrap/Col'
import ButtonState from '@/components/Button/ButtonState'
import ModalAlert from '@/components/Modals/ModalAlert'
import RangeSlider from '@/components/RangeSlider/RangeSlider'
import { encrypt } from '@/utils/helpers'
import Card from 'react-bootstrap/Card'
import Badge from 'react-bootstrap/Badge'


interface DataUserState {
  isLogin: boolean
  userData: any | null
  takecareData: any | null
}

const TemperatureSetting = () => {
  const router = useRouter()

  // State สำหรับ modal แจ้งเตือน
  const [alert, setAlert] = useState({ show: false, message: '' })
  // State สำหรับ loading ขณะดึงข้อมูลหรือบันทึก
  const [isLoading, setLoading] = useState(false)
  // ข้อมูลผู้ใช้และผู้ดูแล
  const [dataUser, setDataUser] = useState<DataUserState>({
    isLogin: false,
    userData: null,
    takecareData: null,
  })
  // รหัส setting ที่ดึงหรือสร้างใหม่
  const [idSetting, setIdSetting] = useState<number | null>(null)
  // ค่าอุณหภูมิสูงสุดที่ตั้งไว้
  const [maxTemperature, setMaxTemperature] = useState<number>(37)

  // เมื่อ auToken ใน query เปลี่ยน จะดึงข้อมูลผู้ใช้
  useEffect(() => {
    const auToken = router.query.auToken
    if (auToken) {
      fetchUserData(auToken as string)
      return
    }

    // Development-only: inject mock user/takecare so page can be tested without LINE
    if (!auToken && process.env.NODE_ENV === 'development') {
      setDataUser({
        isLogin: true,
        userData: { users_id: 1, users_line_id: 'dev-mock' },
        takecareData: { takecare_id: 1 }
      })
      setLoading(false)
    }
  }, [router.query.auToken])

  // ฟังก์ชันดึงข้อมูลผู้ใช้และผู้ดูแล
  const fetchUserData = async (auToken: string) => {
    try {
      const responseUser = await axios.get(`/api/user/getUser/${auToken}`)
      if (responseUser.data?.data) {
        const encodedUsersId = encrypt(responseUser.data.data.users_id.toString())
        const responseTakecare = await axios.get(
          `/api/user/getUserTakecareperson/${encodedUsersId}`
        )
        const takecareData = responseTakecare.data?.data
        if (takecareData) {
          setDataUser({ isLogin: true, userData: responseUser.data.data, takecareData: takecareData })
          const settingIdParam = router.query.idsetting
          if (settingIdParam && Number(settingIdParam) > 0) {
            fetchTemperatureSetting(Number(settingIdParam))
          }
        } else {
          showAlert('ไม่พบข้อมูลผู้ดูแล')
        }
      } else {
        showAlert('ไม่พบข้อมูลผู้ใช้')
      }
    } catch (error) {
      showAlert('ระบบไม่สามารถดึงข้อมูลของท่านได้ กรุณาลองใหม่อีกครั้ง')
    }
  }

  // ฟังก์ชันดึงข้อมูลการตั้งค่าอุณหภูมิ
  const fetchTemperatureSetting = async (settingId: number) => {
    try {
      const res = await axios.get(`/api/setting/getTemperature?setting_id=${settingId}`)
      if (res.data?.data) {
        const data = res.data.data
        setMaxTemperature(Number(data.max_temperature))
        setIdSetting(settingId)
      }
    } catch (error) {
      showAlert('ไม่สามารถดึงข้อมูลการตั้งค่าได้')
    }
  }

  // แสดง modal แจ้งเตือน
  const showAlert = (message: string) => {
    setAlert({ show: true, message })
  }

  // บันทึกข้อมูลอุณหภูมิ
  const handleSave = async () => {
    if (!dataUser.takecareData || !dataUser.userData) {
      showAlert('ไม่พบข้อมูลผู้ใช้งาน')
      return
    }
    setLoading(true)
    try {
      const payload: any = {
        takecare_id: dataUser.takecareData.takecare_id,
        users_id: dataUser.userData.users_id,
        max_temperature: maxTemperature,
      }
      if (idSetting) {
        payload.setting_id = idSetting
      }
      const res = await axios.post(`/api/setting/saveTemperature`, payload)
      if (res.data?.id) {
        setIdSetting(res.data.id)
        router.push(`/settingTemp?auToken=${router.query.auToken}&idsetting=${res.data.id}`)
      }
      showAlert('บันทึกข้อมูลสำเร็จ')
    } catch (error) {
      showAlert('ไม่สามารถบันทึกข้อมูลได้')
    }
    setLoading(false)
  }

  return (
    <>
      {!dataUser.isLogin ? (
        <div className="d-flex justify-content-center align-items-center" style={{ height: '80vh' }}>
          <Spinner animation="border" variant="primary" />
        </div>
      ) : (
        <Container className="d-flex justify-content-center align-items-center min-vh-100" style={{ background: "#f7fafd" }}>
          <div
            className="shadow"
            style={{
              background: "#fff",
              borderRadius: 24,
              padding: "32px 24px 28px 24px",
              maxWidth: 380,
              width: "100%",
              boxShadow: "0 2px 24px 0 rgba(0,0,0,0.07)"
            }}
          >
            <div className="text-center mb-3">
              {/* SVG ไอคอนอุณหภูมิ */}
              <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24"><path fill="#000" d="M14 4.5a4.5 4.5 0 0 0-9 0v9.44a.23.23 0 0 1-.06.16a6 6 0 1 0 9.12 0a.23.23 0 0 1-.06-.16ZM9.5 22a4 4 0 0 1-2.8-6.86a1 1 0 0 0 .3-.71V4.5a2.5 2.5 0 0 1 5 0v9.93a1 1 0 0 0 .3.71A4 4 0 0 1 9.5 22" /><path fill="#000" d="M10.61 16.34a.26.26 0 0 1-.11-.21V8.5a1 1 0 0 0-2 0v7.63a.26.26 0 0 1-.11.21a2 2 0 1 0 2.22 0m8.89-4.84H17a1 1 0 0 0 0 2h2.5a1 1 0 0 0 0-2m-2.5-6h2.5a1 1 0 0 0 0-2H17a1 1 0 0 0 0 2m2.5 2H17a1 1 0 0 0 0 2h2.5a1 1 0 0 0 0-2" /></svg>
            </div>
            <div className="text-center mb-3">
              <h2 style={{ fontWeight: 700, color: "#2c3746", marginBottom: 12, fontSize: 26, lineHeight: 1.2 }}>
                ตั้งค่าการแจ้งเตือน<br />อุณหภูมิร่างกาย
              </h2>
            </div>
            <Card className="mb-3" style={{ borderRadius: 16, border: '1px solid #eef1f6' }}>
              <Card.Body style={{ padding: '12px 14px' }}>
                <Badge bg="light" text="dark" style={{ border: '1px solid #e8ecf3' }}>คำแนะนำ</Badge>
                <div style={{ fontSize: 14, color: '#48526b', marginTop: 8 }}>
                  อุณหภูมิร่างกายทั่วไปอยู่ที่: <strong>36.5–37.5°C</strong><br />
                </div>
              </Card.Body>
            </Card>
            <div className="mb-2" style={{ fontSize: 18, color: "#48526b", fontWeight: 500 }}>
              กำหนดเกณฑ์สูงสุด:
              <span style={{ color: "#ff6641", fontWeight: 700, marginLeft: 6 }}>{maxTemperature}°C</span>
            </div>
            <div className="my-3">
              <RangeSlider
                min={30}
                max={45}
                step={0.1}
                value={maxTemperature}
                onChange={(value) => setMaxTemperature(Number(value))}
              />
            </div>
            <div className="mb-4" style={{ fontSize: 16, color: "#48526b", marginTop: 20 }}>
              หากค่าอุณหภูมิเกินเกณฑ์ที่ตั้งไว้ ระบบจะแจ้งเตือนทันทีผ่าน LINE
            </div>
            <ButtonState
              text="✔ บันทึกการตั้งค่า"
              isLoading={isLoading}
              onClick={handleSave}
              className="w-100"
            />
            <ModalAlert show={alert.show} message={alert.message} handleClose={() => setAlert({ show: false, message: '' })} />
          </div>
        </Container>
      )}
    </>
  )
}

export default TemperatureSetting
