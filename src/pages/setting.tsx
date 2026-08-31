'use client'
import React, { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/router'
import axios from 'axios'

import { GoogleMap, Marker, Circle } from '@react-google-maps/api'
import { useGoogleMaps } from '@/providers/GoogleMapsProvider'

import ModalAlert from '@/components/Modals/ModalAlert'
import { encrypt } from '@/utils/helpers'

interface Location {
  latitude: number
  longitude: number
}

interface DataUserState {
  isLogin: boolean
  userData: any | null
  takecareData: any | null
}

interface SafezoneStage {
  takecare_id: number
  users_id: number
  safezone_id?: number
  safez_latitude: string
  safez_longitude: string
  safez_radiuslv1: number
  safez_radiuslv2: number
}

const Setting = () => {
  const router = useRouter()
  const { isLoaded } = useGoogleMaps()

  const [location, setLocation] = useState<Location>({
    latitude: 13.8900000,
    longitude: 100.5993555,
  })

  const [alert, setAlert] = useState({ show: false, message: '' })
  const [isLoading, setLoading] = useState(false)
  const [range1, setRange1] = useState(10)
  const [range2, setRange2] = useState(20)
  
  const [dataUser, setDataUser] = useState<DataUserState>({ isLogin: false, userData: null, takecareData: null })
  const [idSafezoneStage, setIdSafezoneStage] = useState(0)

  useEffect(() => {
    const auToken = router.query.auToken
    if (auToken) {
      onGetUserData(auToken as string)
      return
    }

    // สำหรับเทสในโหมด Development แบบเดียวกับหน้าอื่นๆ
    if (!auToken && process.env.NODE_ENV === 'development') {
      setDataUser({ isLogin: true, userData: { users_id: 1, users_line_id: 'dev-mock' }, takecareData: { takecare_id: 1 } })
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      })
    }
  }, [router.query.auToken])

  const onGetSafezone = async (idSafezone: string, takecareData: any, userData: any) => {
    try {
      const resSafezone = await axios.get(`/api/setting/getSafezone?takecare_id=${takecareData.takecare_id}&users_id=${userData.users_id}&id=${idSafezone}`)
      if (resSafezone.data?.data) {
        const data = resSafezone.data?.data
        setLocation({
          latitude: Number(data.safez_latitude),
          longitude: Number(data.safez_longitude),
        })
        setRange1(data.safez_radiuslv1)
        setRange2(data.safez_radiuslv2)
        setIdSafezoneStage(Number(idSafezone))
      }
    } catch (error) {
      console.log("🚀 ~ error:", error)
      showAlert('ระบบไม่สามารถดึงข้อมูลการตั้งค่าเดิมได้')
    }
  }

  const onGetUserData = async (auToken: string) => {
    try {
      const responseUser = await axios.get(`/api/user/getUser/${auToken}`)
      if (responseUser.data?.data) {
        const encodedUsersId = encrypt(responseUser.data?.data.users_id.toString())
        const responseTakecareperson = await axios.get(`/api/user/getUserTakecareperson/${encodedUsersId}`)
        const data = responseTakecareperson.data?.data

        if (data) {
          setDataUser({ isLogin: true, userData: responseUser.data?.data, takecareData: data })
          const idSafezone = router.query.idsafezone
          if (idSafezone && Number(idSafezone) > 0) {
            onGetSafezone(idSafezone as string, data, responseUser.data?.data)
          }
        } else {
          showAlert('ไม่พบข้อมูลผู้ดูแล')
        }
      } else {
        showAlert('ไม่พบข้อมูลผู้ใช้งาน')
      }
    } catch (error) {
      console.log("🚀 ~ error:", error)
      showAlert('ระบบไม่สามารถดึงข้อมูลของท่านได้ กรุณาลองใหม่อีกครั้ง')
      setDataUser({ isLogin: false, userData: null, takecareData: null })
    }
  }

  const showAlert = (message: string) => {
    setAlert({ show: true, message })
  }

  const center = useMemo(() => ({ lat: location.latitude, lng: location.longitude }), [location])

  const handleSave = async () => {
    if (!dataUser.takecareData || !dataUser.userData) {
        showAlert('ไม่พบข้อมูลผู้ใช้งาน')
        return
    }

    try {
      setLoading(true)
      let data: SafezoneStage = {
        takecare_id: dataUser.takecareData.takecare_id,
        users_id: dataUser.userData.users_id,
        safez_latitude: location.latitude.toString(),
        safez_longitude: location.longitude.toString(),
        safez_radiuslv1: range1,
        safez_radiuslv2: range2,
      }
      if (idSafezoneStage > 0) {
        data['safezone_id'] = idSafezoneStage
      }
      const res = await axios.post(`/api/setting/saveSafezone`, data)
      if (res.data?.id) {
        router.push(`/setting?auToken=${router.query.auToken}&idsafezone=${res.data.id}`)
      }
      showAlert('บันทึกข้อมูลสำเร็จ')
    } catch (error) {
      showAlert('ไม่สามารถบันทึกข้อมูลได้')
    }
    setLoading(false)
  }

  const onMapClick = (e: google.maps.MapMouseEvent) => {
    if (e.latLng) {
      setLocation({
        latitude: e.latLng.lat(),
        longitude: e.latLng.lng(),
      })
    }
  }

  const updateRange1 = (value: number) => {
    let v = Math.max(1, Math.round(value))
    if (v >= range2) v = range2 - 1 // ห้ามเกินระยะที่ 2
    setRange1(v)
  }

  const updateRange2 = (value: number) => {
    let v = Math.max(range1 + 1, Math.round(value))
    setRange2(v)
  }

  const containerStyle = {
    width: '100%',
    height: '350px',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  }

  return (
    <>
      {!isLoaded || !dataUser.isLogin ? (
        <div id="loader">
          <div className="spinner" />
        </div>
      ) : (
        <div>
          <style jsx global>{`
            /* CSS Theme กลางจากดีไซน์ */
            @import url('https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&display=swap');
            :root{--primary-color:#1DB446;--primary-dark:#159135;--bg-color:#f4f7f6;--text-main:#2c3e50;--text-light:#7f8c8d;--border-color:#e2e8f0}
            *{box-sizing:border-box;margin:0;padding:0;font-family:'Kanit',sans-serif;-webkit-tap-highlight-color:transparent}
            body{background-color:var(--bg-color);color:var(--text-main);display:flex;flex-direction:column;height:100vh}
            .header{background:linear-gradient(135deg,var(--primary-color) 0%,var(--primary-dark) 100%);color:white;padding:18px 24px;font-size:1.3rem;font-weight:600;box-shadow:0 2px 10px rgba(0,0,0,0.08);display:flex;align-items:center;z-index:10}
            .header-icon{margin-right:12px;font-size:1.5rem}
            .main-layout{display:flex;flex:1;flex-direction:column;overflow:hidden}
            .content-area{flex:1;padding:20px;overflow-y:auto}
            .form-container{background:white;padding:24px;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.03);border:1px solid var(--border-color);margin-bottom:90px;display:none}
            .form-container.active{display:block;animation:fadeIn .3s ease-out}
            @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
            .form-section-title{color:var(--primary-dark);font-size:1.25rem;font-weight:600;margin-bottom:24px;display:flex;align-items:center;gap:10px}
            .form-section-title::before{content:'';width:4px;height:20px;background:var(--primary-color);border-radius:4px}
            .form-group{margin-bottom:24px;background:#fafcfa;padding:16px;border-radius:12px;border:1px solid #edf2f7;transition:opacity .3s}
            .form-label{display:flex;justify-content:space-between;align-items:center;font-size:1.05rem;font-weight:500;margin-bottom:8px}
            .value-badge{background:#e8f5e9;color:var(--primary-dark);padding:4px 12px;border-radius:20px;font-weight:600;font-size:1rem;transition:all .3s}
            .default-recommend-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:8px;border-bottom:1px dashed #e2e8f0}
            .recommend-text{font-size:.85rem;color:#64748b}
            .recommend-text b{color:#0f172a}
            .control-layout{display:flex;flex-direction:column;gap:16px}
            input[type=range]{-webkit-appearance:none;width:100%;height:6px;background:#e2e8f0;border-radius:4px;outline:none}
            input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;border-radius:50%;background:white;border:3px solid var(--primary-color);box-shadow:0 2px 6px rgba(0,0,0,0.15);cursor:pointer;transition:border-color .3s}
            .stepper-wrapper{display:flex;align-items:center;justify-content:space-between;background:white;border:1px solid var(--border-color);border-radius:12px;overflow:hidden}
            .btn-step{width:50px;height:50px;background:#f8fafc;border:none;font-size:1.5rem;color:var(--text-main);cursor:pointer;display:flex;align-items:center;justify-content:center}
            .btn-step:active{background:#e2e8f0}
            .form-control-number{flex:1;text-align:center;border:none;font-size:1.2rem;font-weight:600;color:var(--text-main);background:white;padding:0;outline:none}
            .form-control-number::-webkit-outer-spin-button,.form-control-number::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
            .submit-container{position:fixed;bottom:0;left:0;width:100%;padding:16px 20px;background:white;box-shadow:0 -4px 12px rgba(0,0,0,0.05);z-index:20}
            .btn-submit{width:100%;padding:16px;background:var(--primary-color);color:white;border:none;border-radius:12px;font-size:1.15rem;font-weight:600;cursor:pointer;box-shadow:0 4px 10px rgba(29,180,70,0.2);display:flex;justify-content:center;align-items:center;gap:8px}
            .btn-submit:active{transform:scale(.98)}
            #loader{position:fixed;inset:0;background:rgba(255,255,255,.9);display:flex;flex-direction:column;justify-content:center;align-items:center;z-index:1000}
            .spinner{border:4px solid #f3f3f3;border-top:4px solid var(--primary-color);border-radius:50%;width:48px;height:48px;animation:spin 1s linear infinite}
            @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
            .status-card{background:#f0fff4;border:1px solid #c6f6d5;border-radius:12px;padding:18px;display:flex;align-items:center;gap:16px;margin-bottom:20px;transition:all .3s}
            .status-icon{font-size:2.8rem;transition:all .3s;flex-shrink:0}
            .advice-text h4{color:#2f855a;font-size:1.15rem;margin-bottom:4px}
            .advice-text p{color:#4a5568;font-size:.92rem;line-height:1.45}
            
            /* Warning Theme */
            .theme-warning .value-badge{background:#fffbeb !important;color:#d97706 !important}
            .theme-warning input[type=range]::-webkit-slider-thumb{border-color:#d97706 !important}
            
            /* Danger Theme */
            .theme-danger .value-badge{background:#fff5f5 !important;color:#e53e3e !important}
            .theme-danger input[type=range]::-webkit-slider-thumb{border-color:#e53e3e !important}

            @media (min-width:768px){.main-layout{flex-direction:row}.content-area{padding:40px;display:flex;justify-content:center}.form-container{width:100%;max-width:600px;margin-bottom:0}.submit-container{position:relative;box-shadow:none;background:transparent;padding:0;margin-top:24px}}
          `}</style>

          <header className="header"><span className="header-icon">⚙️</span>ตั้งค่าระบบ AFE PLUS</header>
          
          <main className="main-layout">
            <section className="content-area">
              <div className="form-container active" style={{ display: 'block' }}>
                <h3 className="form-section-title">ตั้งค่าเขตปลอดภัย (Safezone)</h3>

                <div className="status-card" style={{ background: '#f8fafc', borderColor: '#e2e8f0' }}>
                  <div className="status-icon">📍</div>
                  <div className="advice-text">
                    <h4 style={{ color: '#0f172a' }}>จุดศูนย์กลางเขตปลอดภัย</h4>
                    <p>แตะที่จุดบนแผนที่เพื่อเลือก หรือเปลี่ยนตำแหน่งศูนย์กลางเขตปลอดภัย (เช่น บ้าน หรือสถานที่พัก)</p>
                  </div>
                </div>

                {/* แผนที่ */}
                <div style={{ marginBottom: '24px' }}>
                  <GoogleMap
                    clickableIcons={false}
                    mapContainerStyle={containerStyle}
                    center={center}
                    zoom={17}
                    options={{
                      mapTypeControl: true,
                      streetViewControl: false,
                      zoomControlOptions: {
                        position: window.google.maps.ControlPosition.LEFT_CENTER,
                      },
                    }}
                    onClick={(e) => onMapClick(e)}
                  >
                    <Marker
                      position={{ lat: location.latitude, lng: location.longitude }}
                      icon={{
                        url: 'https://maps.google.com/mapfiles/kml/pal2/icon10.png',
                        scaledSize: new window.google.maps.Size(35, 35),
                      }}
                    >
                      <>
                        <Circle
                          center={{ lat: location.latitude, lng: location.longitude }}
                          radius={range1}
                          options={{ fillColor: "#F2BE22", strokeColor: "#F2BE22", fillOpacity: 0.2 }}
                        />
                        <Circle
                          center={{ lat: location.latitude, lng: location.longitude }}
                          radius={range2}
                          options={{ fillColor: "#F24C3D", strokeColor: "#F24C3D", fillOpacity: 0.1 }}
                        />
                      </>
                    </Marker>
                  </GoogleMap>
                </div>

                {/* ตั้งค่ารัศมีชั้นที่ 1 */}
                <div className="theme-warning">
                  <div className="form-group">
                    <label className="form-label">
                      รัศมี เขตปลอดภัย ชั้นที่ 1
                      <span className="value-badge"><span>{range1}</span> เมตร</span>
                    </label>
                    <div className="default-recommend-row">
                      <span className="recommend-text">พื้นที่เตือนระวัง (สีเหลือง)</span>
                    </div>
                    <div className="control-layout">
                      <input 
                        type="range" 
                        min={10} 
                        max={range2 - 1} 
                        step={1} 
                        value={range1} 
                        onChange={(e) => updateRange1(Number(e.target.value))} 
                      />
                      <div className="stepper-wrapper">
                        <button type="button" className="btn-step" onClick={() => updateRange1(range1 - 1)}>-</button>
                        <input 
                          type="number" 
                          className="form-control-number" 
                          min={10} 
                          max={range2 - 1} 
                          value={range1} 
                          onChange={(e) => updateRange1(Number(e.target.value))} 
                        />
                        <button type="button" className="btn-step" onClick={() => updateRange1(range1 + 1)}>+</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ตั้งค่ารัศมีชั้นที่ 2 */}
                <div className="theme-danger">
                  <div className="form-group">
                    <label className="form-label">
                      รัศมี เขตปลอดภัย ชั้นที่ 2
                      <span className="value-badge"><span>{range2}</span> เมตร</span>
                    </label>
                    <div className="default-recommend-row">
                      <span className="recommend-text">พื้นที่อันตราย (สีแดง)</span>
                    </div>
                    <div className="control-layout">
                      <input 
                        type="range" 
                        min={range1 + 1} 
                        max={1000} 
                        step={1} 
                        value={range2} 
                        onChange={(e) => updateRange2(Number(e.target.value))} 
                      />
                      <div className="stepper-wrapper">
                        <button type="button" className="btn-step" onClick={() => updateRange2(range2 - 1)}>-</button>
                        <input 
                          type="number" 
                          className="form-control-number" 
                          min={range1 + 1} 
                          max={1000} 
                          value={range2} 
                          onChange={(e) => updateRange2(Number(e.target.value))} 
                        />
                        <button type="button" className="btn-step" onClick={() => updateRange2(range2 + 1)}>+</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="submit-container">
                  <button className="btn-submit" onClick={handleSave} disabled={isLoading}>
                    {isLoading ? 'กำลังบันทึก...' : '✔ บันทึกการตั้งค่า'}
                  </button>
                </div>
              </div>
            </section>
          </main>
          
          <ModalAlert show={alert.show} message={alert.message} handleClose={() => setAlert({ show: false, message: '' })} />
        </div>
      )}
    </>
  )
}

export default Setting