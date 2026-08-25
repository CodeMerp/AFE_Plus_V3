'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import axios from 'axios'
import ModalAlert from '@/components/Modals/ModalAlert'
import { encrypt } from '@/utils/helpers'

const SettingHeartRate = () => {
  const router = useRouter()

  const [alert, setAlert] = useState({ show: false, message: '' })
  const [isLoading, setLoading] = useState(false)
  const [dataUser, setDataUser] = useState<{ isLogin: boolean; userData: any | null; takecareData: any | null }>({ isLogin: false, userData: null, takecareData: null })

  const [idSetting, setIdSetting] = useState<number | null>(null)
  const [maxBpm, setMaxBpm] = useState<number>(110)
  const [minBpm, setMinBpm] = useState<number>(55)
  const [minEnabled, setMinEnabled] = useState<boolean>(true)

  useEffect(() => {
    const auToken = router.query.auToken
    if (auToken) {
      fetchUserData(auToken as string)
      return
    }
    if (!auToken && process.env.NODE_ENV === 'development') {
      setDataUser({ isLogin: true, userData: { users_id: 1, users_line_id: 'dev-mock' }, takecareData: { takecare_id: 1 } })
    }
  }, [router.query.auToken])

  const fetchUserData = async (auToken: string) => {
    try {
      const responseUser = await axios.get(`/api/user/getUser/${auToken}`)
      if (responseUser.data?.data) {
        const encodedUsersId = encrypt(responseUser.data.data.users_id.toString())
        const responseTakecare = await axios.get(`/api/user/getUserTakecareperson/${encodedUsersId}`)
        const takecareData = responseTakecare.data?.data
        if (takecareData) {
          setDataUser({ isLogin: true, userData: responseUser.data.data, takecareData: takecareData })
          const settingIdParam = router.query.idsetting
          if (settingIdParam && Number(settingIdParam) > 0) fetchHeartRateSetting(Number(settingIdParam))
        } else showAlert('ไม่พบข้อมูลผู้ดูแล')
      } else showAlert('ไม่พบข้อมูลผู้ใช้')
    } catch (error) {
      showAlert('ระบบไม่สามารถดึงข้อมูลของท่านได้ กรุณาลองใหม่อีกครั้ง')
    }
  }

  const fetchHeartRateSetting = async (settingId: number) => {
    try {
      const res = await axios.get(`/api/setting/getHeartRate?id=${settingId}`)
      if (res.data?.data) {
        const data = res.data.data
        setMaxBpm(Number(data.max_bpm ?? maxBpm))
        setMinBpm(Number(data.min_bpm ?? minBpm))
        setMinEnabled(Boolean(data.min_enable ?? minEnabled))
        setIdSetting(settingId)
      }
    } catch (error) {
      showAlert('ไม่สามารถดึงข้อมูลการตั้งค่าได้')
    }
  }

  const showAlert = (message: string) => setAlert({ show: true, message })

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
        max_bpm: maxBpm,
        min_bpm: minBpm,
        min_enable: minEnabled,
      }
      if (idSetting) payload.id = idSetting
      const res = await axios.post(`/api/setting/saveHeartRate`, payload)
      if (res.data?.id) {
        setIdSetting(res.data.id)
        router.push(`/settingHeartRate?auToken=${router.query.auToken}&idsetting=${res.data.id}`)
      }
      showAlert('บันทึกข้อมูลสำเร็จ')
    } catch (error) {
      showAlert('ไม่สามารถบันทึกข้อมูลได้')
    }
    setLoading(false)
  }

  const updateValue = (id: 'pulseMax' | 'pulseMin', value: number) => {
    if (id === 'pulseMax') {
      let v = Math.max(60, Math.min(200, Math.round(value)))
      setMaxBpm(v)
    } else {
      let v = Math.max(30, Math.min(100, Math.round(value)))
      setMinBpm(v)
    }
  }

  const stepValue = (id: 'pulseMax' | 'pulseMin', step: number) => {
    if (id === 'pulseMax') updateValue('pulseMax', maxBpm + step)
    else updateValue('pulseMin', minBpm + step)
  }

  const togglePulseMin = (enabled: boolean) => {
    setMinEnabled(enabled)
  }

  const themeForMax = () => (maxBpm > 120 ? 'theme-danger' : maxBpm >= 101 ? 'theme-warning' : '')
  const themeForMin = () => (!minEnabled ? 'theme-disabled' : minBpm < 50 ? 'theme-danger' : minBpm <= 59 ? 'theme-warning' : '')

  return (
    <>
      {!dataUser.isLogin ? (
        <div id="loader">
          <div className="spinner" />
        </div>
      ) : (
        <div>
          <style jsx global>{`
/* pasted CSS from template */
@import url('https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&display=swap');
:root{--primary-color:#1DB446;--primary-dark:#159135;--bg-color:#f4f7f6;--text-main:#2c3e50;--text-light:#7f8c8d;--border-color:#e2e8f0}
*{box-sizing:border-box;margin:0;padding:0;font-family:'Kanit',sans-serif;-webkit-tap-highlight-color:transparent}
body{background-color:var(--bg-color);color:var(--text-main);display:flex;flex-direction:column;height:100vh}
.header{background:linear-gradient(135deg,var(--primary-color) 0%,var(--primary-dark) 100%);color:white;padding:18px 24px;font-size:1.3rem;font-weight:600;box-shadow:0 2px 10px rgba(0,0,0,0.08);display:flex;align-items:center;z-index:10}
.header-icon{margin-right:12px;font-size:1.5rem}
.main-layout{display:flex;flex:1;flex-direction:column;overflow:hidden}
.tabs-container{display:flex;background:white;box-shadow:0 2px 5px rgba(0,0,0,0.02);z-index:9}
.tab-btn{flex:1;padding:14px 8px;background:none;border:none;font-size:1rem;font-weight:500;color:var(--text-light);border-bottom:3px solid transparent;cursor:pointer;transition:all .2s;display:flex;flex-direction:column;align-items:center;gap:4px}
.tab-btn.active{color:var(--primary-dark);font-weight:600;border-bottom-color:var(--primary-color)}
.tab-btn .tab-icon{font-size:1.3rem}.content-area{flex:1;padding:20px;overflow-y:auto}.form-container{background:white;padding:24px;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.03);border:1px solid var(--border-color);margin-bottom:90px;display:none}.form-container.active{display:block;animation:fadeIn .3s ease-out}@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.form-section-title{color:var(--primary-dark);font-size:1.25rem;font-weight:600;margin-bottom:24px;display:flex;align-items:center;gap:10px}.form-section-title::before{content:'';width:4px;height:20px;background:var(--primary-color);border-radius:4px}
.form-group{margin-bottom:24px;background:#fafcfa;padding:16px;border-radius:12px;border:1px solid #edf2f7;transition:opacity .3s}.form-label{display:flex;justify-content:space-between;align-items:center;font-size:1.05rem;font-weight:500;margin-bottom:8px}.value-badge{background:#e8f5e9;color:var(--primary-dark);padding:4px 12px;border-radius:20px;font-weight:600;font-size:1rem;transition:all .3s}
.toggle-row{display:flex;justify-content:space-between;align-items:center;background:#f8fafc;border:1px solid #e2e8f0;padding:14px 16px;border-radius:12px;margin-bottom:16px}.toggle-title{font-size:1.05rem;font-weight:500;color:var(--text-main)}.toggle-desc{font-size:.85rem;color:var(--text-light)}
.switch{position:relative;display:inline-block;width:52px;height:28px;flex-shrink:0}.switch input{opacity:0;width:0;height:0}.slider-round{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#cbd5e1;transition:.3s;border-radius:34px}.slider-round:before{position:absolute;content:"";height:22px;width:22px;left:3px;bottom:3px;background-color:white;transition:.3s;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.15)}input:checked+.slider-round{background-color:var(--primary-color)}input:checked+.slider-round:before{transform:translateX(24px)}
.controls-disabled{opacity:.45;pointer-events:none;user-select:none}.default-recommend-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:8px;border-bottom:1px dashed #e2e8f0}.recommend-text{font-size:.85rem;color:#64748b}.recommend-text b{color:#0f172a}.btn-preset{background:#f1f5f9;border:1px solid #cbd5e1;color:#334155;font-size:.8rem;font-weight:500;padding:4px 10px;border-radius:6px;cursor:pointer;transition:all .2s}.btn-preset:active{background:#e2e8f0;transform:scale(.96)}.control-layout{display:flex;flex-direction:column;gap:16px}input[type=range]{-webkit-appearance:none;width:100%;height:6px;background:#e2e8f0;border-radius:4px;outline:none}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;border-radius:50%;background:white;border:3px solid var(--primary-color);box-shadow:0 2px 6px rgba(0,0,0,0.15);cursor:pointer;transition:border-color .3s}
.stepper-wrapper{display:flex;align-items:center;justify-content:space-between;background:white;border:1px solid var(--border-color);border-radius:12px;overflow:hidden}.btn-step{width:50px;height:50px;background:#f8fafc;border:none;font-size:1.5rem;color:var(--text-main);cursor:pointer;display:flex;align-items:center;justify-content:center}.btn-step:active{background:#e2e8f0}.btn-step:disabled{color:#cbd5e1;cursor:not-allowed;background:#f8fafc}.form-control-number{flex:1;text-align:center;border:none;font-size:1.2rem;font-weight:600;color:var(--text-main);background:white;padding:0;outline:none}.form-control-number::-webkit-outer-spin-button,.form-control-number::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}.hint{font-size:.9rem;color:var(--text-light);margin-top:12px;display:flex;align-items:flex-start;gap:6px}.submit-container{position:fixed;bottom:0;left:0;width:100%;padding:16px 20px;background:white;box-shadow:0 -4px 12px rgba(0,0,0,0.05);z-index:20}.btn-submit{width:100%;padding:16px;background:var(--primary-color);color:white;border:none;border-radius:12px;font-size:1.15rem;font-weight:600;cursor:pointer;box-shadow:0 4px 10px rgba(29,180,70,0.2);display:flex;justify-content:center;align-items:center;gap:8px}.btn-submit:active{transform:scale(.98)}#loader{position:fixed;inset:0;background:rgba(255,255,255,.9);display:flex;flex-direction:column;justify-content:center;align-items:center;z-index:1000}.spinner{border:4px solid #f3f3f3;border-top:4px solid var(--primary-color);border-radius:50%;width:48px;height:48px;animation:spin 1s linear infinite}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}.status-card{background:#f0fff4;border:1px solid #c6f6d5;border-radius:12px;padding:18px;display:flex;align-items:center;gap:16px;margin-bottom:20px;transition:all .3s}.status-icon{font-size:2.8rem;transition:all .3s;flex-shrink:0}.advice-text h4{color:#2f855a;font-size:1.15rem;margin-bottom:4px}.advice-text p{color:#4a5568;font-size:.92rem;line-height:1.45}.pulse-anim{animation:heartbeat 1.2s infinite cubic-bezier(.215,.61,.355,1)}@keyframes heartbeat{0%,100%{transform:scale(.95)}5%,25%{transform:scale(1.1)}15%{transform:scale(1.2)}50%{transform:scale(.95)}}.theme-warning .status-card{background:#fffbeb;border-color:#fef08a}.theme-warning .advice-text h4{color:#d97706}.theme-warning .value-badge{background:#fffbeb !important;color:#d97706 !important}.theme-warning input[type=range]::-webkit-slider-thumb{border-color:#d97706 !important}.theme-danger .status-card{background:#fff5f5;border-color:#fed7d7}.theme-danger .advice-text h4{color:#e53e3e}.theme-danger .value-badge{background:#fff5f5 !important;color:#e53e3e !important}.theme-danger input[type=range]::-webkit-slider-thumb{border-color:#e53e3e !important}.theme-cool .status-card{background:#ebf8ff;border-color:#bee3f8}.theme-cool .advice-text h4{color:#3182ce}.theme-cool .value-badge{background:#ebf8ff !important;color:#3182ce !important}.theme-cool input[type=range]::-webkit-slider-thumb{border-color:#3182ce !important}.theme-disabled .status-card{background:#f8fafc;border-color:#e2e8f0}.theme-disabled .advice-text h4{color:#64748b}.theme-disabled .value-badge{background:#e2e8f0 !important;color:#64748b !important}@media (min-width:768px){.main-layout{flex-direction:row}.tabs-container{flex-direction:column;width:250px;box-shadow:2px 0 5px rgba(0,0,0,0.02)}.tab-btn{flex-direction:row;padding:20px;border-bottom:none;border-left:4px solid transparent}.tab-btn.active{border-left-color:var(--primary-color);background:#f0fff4}.content-area{padding:40px;display:flex;justify-content:center}.form-container{width:100%;max-width:600px;margin-bottom:0}.submit-container{position:relative;box-shadow:none;background:transparent;padding:0;margin-top:24px}}
`}</style>

          <header className="header"><span className="header-icon">⚙️</span>ตั้งค่าระบบ AFE PLUS</header>
          <main className="main-layout">
            <section className="content-area">
              <div className={`form-container active`} style={{ display: 'block' }} id="pulse" role="tabpanel">
                <h3 className="form-section-title">ตั้งค่าอัตราการเต้นของหัวใจ</h3>

                <div id="group-pulseMax" className={themeForMax()}>
                  <div className="status-card">
                    <div className="status-icon pulse-anim" id="pulse-max-icon">{maxBpm > 120 ? '❤️‍🔥' : maxBpm >= 101 ? '💓' : '💚'}</div>
                    <div className="advice-text">
                      <h4 id="pulse-max-title">{maxBpm > 120 ? 'เตือนเมื่อชีพจรสูงมาก (> 120 bpm)' : maxBpm >= 101 ? 'เตือนเมื่อชีพจรเริ่มสูง (101–120 bpm)' : 'ช่วงชีพจรปกติ (60–100 bpm)'}</h4>
                      <p id="pulse-max-desc">{maxBpm > 120 ? 'เกณฑ์ผู้สูงอายุ: อันตราย ควรประเมินอาการร่วม (เช่น เหนื่อยหอบ หน้ามืด) และติดต่อแพทย์' : maxBpm >= 101 ? 'เกณฑ์ผู้สูงอายุ: ควรเฝ้าระวังหรือให้ผู้สูงอายุพักผ่อนแล้วตรวจซ้ำ' : 'เกณฑ์ผู้สูงอายุ: ช่วงปกติ การตั้งเตือนระดับนี้อาจทำให้แจ้งเตือนบ่อยขณะทำกิจกรรม'}</p>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      ชีพจรแจ้งเตือน (สูงสุด)
                      <span className="value-badge" id="badge-pulseMax"><span id="val_pulseMax">{maxBpm}</span> bpm</span>
                    </label>
                    <div className="default-recommend-row">
                      <span className="recommend-text">ค่าเริ่มต้นแนะนำ: <b>110 bpm</b> (จุดเฝ้าระวังขณะทำกิจกรรม)</span>
                      <button type="button" className="btn-preset" onClick={() => updateValue('pulseMax', 110)}>ใช้ค่าแนะนำ</button>
                    </div>
                    <div className="control-layout">
                      <input type="range" id="pulseMax_slider" min={60} max={200} step={1} value={maxBpm} onChange={(e) => updateValue('pulseMax', Number(e.target.value))} />
                      <div className="stepper-wrapper">
                        <button type="button" className="btn-step" onClick={() => stepValue('pulseMax', -1)} id="btn_pulseMax_minus">-</button>
                        <input type="number" id="pulseMax_input" className="form-control-number" min={60} max={200} value={maxBpm} onChange={(e) => updateValue('pulseMax', Number(e.target.value))} />
                        <button type="button" className="btn-step" onClick={() => stepValue('pulseMax', 1)} id="btn_pulseMax_plus">+</button>
                      </div>
                    </div>
                  </div>
                </div>

                <hr style={{ border: 'none', borderTop: '1px dashed #e2e8f0', margin: '30px 0' }} />

                <div className="toggle-row">
                  <div>
                    <div className="toggle-title">ตรวจจับชีพจรต่ำ</div>
                    <div className="toggle-desc">เปิดเฝ้าระวังภาวะหัวใจเต้นช้าผิดปกติ</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" id="pulseMin_enable" checked={minEnabled} onChange={(e) => togglePulseMin(e.target.checked)} />
                    <span className="slider-round" />
                  </label>
                </div>

                <div id="group-pulseMin" className={themeForMin()}>
                  <div className="status-card">
                    <div className="status-icon pulse-anim" id="pulse-min-icon">{minEnabled ? (minBpm < 50 ? '🫀' : minBpm <= 59 ? '💙' : '💚') : '⏸️'}</div>
                    <div className="advice-text">
                      <h4 id="pulse-min-title">{!minEnabled ? 'ปิดการตรวจจับชีพจรต่ำ' : minBpm < 50 ? 'เตือนเมื่อชีพจรต่ำมาก (< 50 bpm)' : minBpm <= 59 ? 'เตือนเมื่อชีพจรเริ่มต่ำ (50–59 bpm)' : 'ช่วงชีพจรปกติ (60–100 bpm)'}</h4>
                      <p id="pulse-min-desc">{!minEnabled ? 'ระบบจะไม่ส่งการแจ้งเตือนเมื่อชีพจรลดต่ำลง' : minBpm < 50 ? 'เกณฑ์ผู้สูงอายุ: อันตราย เสี่ยงเลือดไปเลี้ยงสมองไม่พอหรือหน้ามืด ควรติดต่อแพทย์' : minBpm <= 59 ? 'เกณฑ์ผู้สูงอายุ: ควรเฝ้าระวังและตรวจซ้ำ (อาจพบช่วงหลับสนิทหรือจากยาบางชนิด)' : 'เกณฑ์ผู้สูงอายุ: ช่วงปกติ การตั้งเตือนระดับนี้อาจทำให้แจ้งเตือนบ่อยขณะนอนหลับ'}</p>
                    </div>
                  </div>

                  <div className={`form-group ${!minEnabled ? 'controls-disabled' : ''}`} id="pulseMin_control_container">
                    <label className="form-label">
                      ชีพจรแจ้งเตือน (ต่ำสุด)
                      <span className="value-badge" id="badge-pulseMin"><span id="val_pulseMin">{minBpm}</span> bpm</span>
                    </label>
                    <div className="default-recommend-row">
                      <span className="recommend-text">ค่าเริ่มต้นแนะนำ: <b>55 bpm</b> (จุดเฝ้าระวังช่วงพักผ่อน/หลับสนิท)</span>
                      <button type="button" className="btn-preset" id="btn_pulseMin_preset" onClick={() => updateValue('pulseMin', 55)}>ใช้ค่าแนะนำ</button>
                    </div>
                    <div className="control-layout">
                      <input type="range" id="pulseMin_slider" min={30} max={100} step={1} value={minBpm} onChange={(e) => updateValue('pulseMin', Number(e.target.value))} disabled={!minEnabled} />
                      <div className="stepper-wrapper">
                        <button type="button" className="btn-step" onClick={() => stepValue('pulseMin', -1)} id="btn_pulseMin_minus" disabled={!minEnabled}>-</button>
                        <input type="number" id="pulseMin_input" className="form-control-number" min={30} max={100} value={minBpm} onChange={(e) => updateValue('pulseMin', Number(e.target.value))} disabled={!minEnabled} />
                        <button type="button" className="btn-step" onClick={() => stepValue('pulseMin', 1)} id="btn_pulseMin_plus" disabled={!minEnabled}>+</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="submit-container">
                  <button className="btn-submit" onClick={handleSave} disabled={isLoading}>{isLoading ? 'กำลังบันทึก...' : '✔ บันทึกการตั้งค่า'}</button>
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

export default SettingHeartRate
