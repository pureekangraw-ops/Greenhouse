const states = {
  loading: {
    connection: 'กำลังตรวจการเชื่อมต่อ', heading: 'กำลังตรวจสอบ', pill: 'กำลังตรวจ',
    className: 'pill--unknown', detail: 'กำลังตรวจตัวอ่านจาก Hub โดยไม่เก็บข้อมูลส่วนตัวไว้ในเครื่อง',
    inboxTitle: 'กำลังตรวจรายการ', inboxDetail: 'รอสักครู่ ระบบกำลังขอผลอ่านกลับจาก Hub', icon: '↻',
  },
  disconnected: {
    connection: 'ยังไม่เชื่อมต่อ', heading: 'ยังไม่เชื่อมต่อ', pill: 'UNKNOWN',
    className: 'pill--unknown', detail: 'หน้าพร้อมใช้งานแบบออฟไลน์ แต่ยังไม่ได้เชื่อมตัวอ่าน Hub และไม่มีข้อมูล Work ถูกเก็บไว้',
    inboxTitle: 'ยังไม่มีผลอ่านกลับที่ยืนยันแล้ว', inboxDetail: 'เชื่อมตัวอ่าน Hub ที่ได้รับอนุญาตเพื่อดู Work เดิม Greenhouse จะไม่สร้าง Work หรือเดาสถานะ', icon: '↻',
  },
  authRequired: {
    connection: 'ต้องเข้าสู่ระบบ', heading: 'ต้องเข้าสู่ระบบ', pill: 'LOGIN',
    className: 'pill--unknown', detail: 'เข้าสู่ระบบผ่านช่องทางเดิมของเจ้าของก่อน จึงจะดู Work ส่วนตัวได้',
    inboxTitle: 'ยังไม่ได้เข้าสู่ระบบ', inboxDetail: 'ใช้การยืนยันตัวตนเดิมที่เจ้าของอนุมัติ Greenhouse จะไม่รับรหัสผ่านหรือ token ผ่านหน้านี้', icon: '⌑',
  },
  connectedEmpty: {
    connection: 'เชื่อมต่อแล้ว', heading: 'เชื่อมต่อแล้ว · ยังไม่มีรายการ', pill: 'CONNECTED',
    className: 'pill--online', detail: 'อ่านจาก Hub แบบ read-only แล้ว',
    inboxTitle: 'ยังไม่มีรายการอ่านกลับ', inboxDetail: 'Hub ส่งรายการว่างกลับมา ณ เวลา', icon: '✓',
  },
  loadError: {
    connection: 'ตรวจไม่สำเร็จ', heading: 'โหลดข้อมูลไม่สำเร็จ', pill: 'ERROR',
    className: 'pill--unknown', detail: 'ยังยืนยันผลอ่านกลับไม่ได้ ลองตรวจอีกครั้งภายหลัง',
    inboxTitle: 'โหลดรายการไม่สำเร็จ', inboxDetail: 'ไม่มีการแสดงข้อมูลค้างหรือข้อมูลจำลอง กด “ตรวจการเชื่อมต่อ” เพื่อลองใหม่', icon: '!',
  },
  connected: {
    connection: 'เชื่อมต่อแล้ว', heading: 'เชื่อมต่อแล้ว', pill: 'CONNECTED',
    className: 'pill--online', detail: 'รายการต่อไปนี้มาจาก Hub ที่ได้รับอนุญาต และเป็นข้อมูล read-only',
  },
};

export function getConnectionState(key) {
  return states[key] || states.loadError;
}

export function getErrorState(code) {
  if (code === 'OWNER_SESSION_REQUIRED') return 'authRequired';
  if (code === 'HUB_READER_UNAVAILABLE' || code === 'OWNER_SESSION_UNAVAILABLE') return 'disconnected';
  return 'loadError';
}
