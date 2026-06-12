// ============================================================
// App.jsx — منصة "احجزلي" نسخة الإنتاج
// انسخ الملف ده كامل في src/App.jsx في مشروع Vite بتاعك
// محتاج: src/lib/supabase.js (موجود في الدليل) + ملف .env بالمفاتيح
// ============================================================
import { useState, useEffect, useMemo, useRef } from "react";
import { Calendar, Clock, User, Phone, Plus, Check, X, Scissors, Trash2, Search, LogOut, Link2, Loader2, MapPin, CreditCard, Settings, MessageCircle, Send, Crown, Wallet, TrendingUp, Stethoscope, QrCode, Share2, Ticket, Shield, Users } from "lucide-react";
import { supabase } from "./lib/supabase";

// ============ إعدادات المنصة ============
const PLATFORM_INSTAPAY = "01202188684"; // رقم إنستاباي بتاعك لاستقبال الاشتراكات
const EDGE_PAYMOB = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paymob-subscribe`;

// ============================================================
// الدوال الحقيقية (Supabase) — كلها هنا متدمجة
// ============================================================
async function signUp(email, password, biz) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  const { error: e2 } = await supabase.from("businesses").insert({
    owner_id: data.user.id, business: biz.business, type: biz.type,
    country: biz.country, address: biz.address,
    wallet: biz.wallet || "", bank: biz.bank || "", cash_ok: true,
  });
  if (e2) throw e2;
  return data.user;
}
async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}
async function signOutUser() { await supabase.auth.signOut(); }

async function myBusiness() {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return null;
  const { data } = await supabase.from("businesses").select("*").eq("owner_id", u.id).maybeSingle();
  const { data: adminRow } = await supabase.from("admins").select("user_id").eq("user_id", u.id).maybeSingle();
  if (adminRow) return { ...(data || { id: u.id, business: "إدارة المنصة", country: "EG", type: "clinic" }), role: "admin" };
  return data;
}
async function updateBusiness(id, fields) {
  const { error } = await supabase.from("businesses").update(fields).eq("id", id);
  if (error) throw error;
}
async function activeBusinesses() {
  const { data } = await supabase.from("businesses")
    .select("id,business,type,country,address,wallet,bank,cash_ok")
    .gte("sub_until", new Date().toISOString().split("T")[0]);
  return data || [];
}
async function getBookings(businessId) {
  const { data } = await supabase.from("bookings")
    .select("*").eq("business_id", businessId).order("date").order("time");
  return data || [];
}
async function addBooking(b) {
  const { error } = await supabase.from("bookings").insert(b);
  if (error) throw error;
}
async function updateBooking(id, fields) {
  const { error } = await supabase.from("bookings").update(fields).eq("id", id);
  if (error) throw error;
}
async function deleteBooking(id) {
  const { error } = await supabase.from("bookings").delete().eq("id", id);
  if (error) throw error;
}
// بحث آمن برقم التليفون (مباشرة عبر الجدول لتجنب مشاكل الـ RPC)
async function bookingsByPhone(phone) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, businesses(business, address, type, country)")
    .eq("client_phone", phone.trim())
    .order("date", { ascending: false })
    .order("time", { ascending: false });
  if (error) { console.error(error); return []; }
  return (data || []).map(b => ({
    ...b,
    biz_name: b.businesses?.business || "",
    biz_address: b.businesses?.address || "",
    biz_type: b.businesses?.type || "",
    biz_country: b.businesses?.country || ""
  }));
}
// طلب تفعيل اشتراك (تحويل إنستاباي يدوي → ينتظر موافقة الأدمن)
async function requestSub(businessId, businessName, country, method, receiptUrl) {
  const insertData = { business_id: businessId, method: method || "instapay" };
  if (receiptUrl) insertData.receipt_url = receiptUrl;
  const { error } = await supabase.from("sub_requests").insert(insertData);
  if (error) throw error;

  // إشعار الأدمن فوراً
  try {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "admin_notify",
        business_name: businessName || "مكان جديد",
        country: country || "EG",
        method: method || "instapay",
        amount: "—",
      }),
    });
  } catch (e) {
    console.log("Email notification failed silently", e);
  }
}
// تفعيل التجربة المجانية فوراً (14 يوم)
async function startTrial(businessId) {
  const until = new Date(); until.setDate(until.getDate() + 14);
  await updateBusiness(businessId, { sub_until: until.toISOString().split("T")[0], is_trial: true });
}
// ====== دوال الأدمن ======
async function adminAllBusinesses() {
  const { data } = await supabase.from("businesses").select("*").order("created_at", { ascending: false });
  return data || [];
}
async function adminPendingSubs() {
  const { data } = await supabase.from("sub_requests")
    .select("*, businesses(id,business,country,address)")
    .eq("status", "pending").order("created_at");
  return data || [];
}
async function adminApprove(reqId, businessId) {
  const until = new Date(); until.setDate(until.getDate() + 30);
  await updateBusiness(businessId, { sub_until: until.toISOString().split("T")[0], is_trial: false });
  await supabase.from("sub_requests").update({ status: "approved" }).eq("id", reqId);
}
async function adminReject(reqId) {
  await supabase.from("sub_requests").update({ status: "rejected" }).eq("id", reqId);
}
// دفع الاشتراك بالبطاقة عبر Paymob (لحسابك أنت فقط)
async function paymobCheckout(businessId, amountCents) {
  const res = await fetch(EDGE_PAYMOB, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ business_id: businessId, amount_cents: amountCents }),
  });
  const { url } = await res.json();
  window.location.href = url; // صفحة Paymob الآمنة لإدخال بيانات البطاقة
}

// رفع إيصال التحويل إلى Supabase Storage
async function uploadReceipt(file, businessId) {
  const ext = file.name.split('.').pop();
  const path = `${businessId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('receipts').upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from('receipts').getPublicUrl(path);
  return data.publicUrl;
}

// ============ الدول ============
const COUNTRIES = [
  { c: "EG", f: "🇪🇬", n: "مصر", cur: "ج.م", p: "500", cents: 50000, l: "eg" },
  { c: "MA", f: "🇲🇦", n: "المغرب", cur: "درهم", p: "100", cents: 100000, l: "ma" },
  { c: "DZ", f: "🇩🇿", n: "الجزائر", cur: "د.ج", p: "1350", cents: 135000, l: "ma" },
  { c: "TN", f: "🇹🇳", n: "تونس", cur: "د.ت", p: "31", cents: 31000, l: "ma" },
  { c: "SA", f: "🇸🇦", n: "السعودية", cur: "ر.س", p: "38", cents: 38000, l: "msa" },
  { c: "AE", f: "🇦🇪", n: "الإمارات", cur: "د.إ", p: "37", cents: 37000, l: "msa" },
  { c: "KW", f: "🇰🇼", n: "الكويت", cur: "د.ك", p: "3", cents: 3000, l: "msa" },
  { c: "QA", f: "🇶🇦", n: "قطر", cur: "ر.ق", p: "36", cents: 36000, l: "msa" },
  { c: "BH", f: "🇧🇭", n: "البحرين", cur: "د.ب", p: "4", cents: 4000, l: "msa" },
  { c: "OM", f: "🇴🇲", n: "عُمان", cur: "ر.ع", p: "4", cents: 4000, l: "msa" },
  { c: "JO", f: "🇯🇴", n: "الأردن", cur: "د.أ", p: "7", cents: 7000, l: "msa" },
  { c: "PS", f: "🇵🇸", n: "فلسطين", cur: "₪", p: "37", cents: 37000, l: "msa" },
  { c: "LB", f: "🇱🇧", n: "لبنان", cur: "$", p: "10", cents: 10000, l: "msa" },
  { c: "IQ", f: "🇮🇶", n: "العراق", cur: "د.ع", p: "13000", cents: 13000000, l: "msa" },
  { c: "LY", f: "🇱🇾", n: "ليبيا", cur: "د.ل", p: "48", cents: 48000, l: "msa" },
  { c: "SD", f: "🇸🇩", n: "السودان", cur: "$", p: "10", cents: 10000, l: "msa" },
  { c: "US", f: "🇺🇸", n: "USA", cur: "$", p: "10", cents: 1000, l: "en" },
  { c: "GB", f: "🇬🇧", n: "UK", cur: "£", p: "8", cents: 800, l: "en" },
  { c: "FR", f: "🇫🇷", n: "France", cur: "€", p: "9", cents: 900, l: "fr" },
  { c: "DE", f: "🇩🇪", n: "Deutschland", cur: "€", p: "9", cents: 900, l: "en" },
  { c: "TR", f: "🇹🇷", n: "Türkiye", cur: "₺", p: "340", cents: 34000, l: "en" },
  { c: "IN", f: "🇮🇳", n: "India", cur: "₹", p: "850", cents: 85000, l: "en" },
  { c: "NG", f: "🇳🇬", n: "Nigeria", cur: "₦", p: "15000", cents: 1500000, l: "en" },
  { c: "SN", f: "🇸🇳", n: "Sénégal", cur: "CFA", p: "6000", cents: 600000, l: "fr" },
  { c: "ZA", f: "🇿🇦", n: "South Africa", cur: "R", p: "180", cents: 18000, l: "en" },
  { c: "CA", f: "🇨🇦", n: "Canada", cur: "C$", p: "14", cents: 1400, l: "en" },
  { c: "AU", f: "🇦🇺", n: "Australia", cur: "A$", p: "15", cents: 1500, l: "en" },
  { c: "PK", f: "🇵🇰", n: "Pakistan", cur: "₨", p: "2800", cents: 280000, l: "en" },
  { c: "OTHER", f: "🌍", n: "Other / أخرى", cur: "$", p: "10", cents: 50000, l: "en" },
];
const getCountry = (c) => COUNTRIES.find(x => x.c === c) || COUNTRIES[COUNTRIES.length - 1];

// ============ النصوص ============
const STR = {
  eg: { dir: "rtl", appName: "احجزلي", tagline: "نظام حجوزات للمستشفيات والعيادات والحلاقين والصالونات", login: "دخول", signup: "حساب جديد", email: "الإيميل", password: "كلمة المرور", bizName: "اسم المكان", address: "العنوان بالتفصيل", types: { hospital: "مستشفى", clinic: "عيادة", barber: "حلاق", salon: "صالون تجميل", dental: "🦷 عيادة أسنان", dermatology: "🧴 جلدية", eye: "👁️ عيون", veterinary: "🐾 بيطري", physiotherapy: "🏃 علاج طبيعي", gym: "💪 جيم", lawyer: "⚖️ محامي", accountant: "📊 محاسب", car_service: "🚗 صيانة سيارات", photographer: "📸 مصور", tutor: "📚 مدرّس", language: "🌍 مركز لغات" }, fillAll: "املأ كل الخانات", wrongCreds: "بيانات الدخول غلط أو الإيميل مش متأكد", createAcc: "إنشاء الحساب", signIn: "تسجيل الدخول", imClient: "أنا عميل وعايز أحجز", bookLink: "رابط الحجز", copied: "اتنسخ ✓", todayBookings: "مواعيد اليوم", arrived: "حضروا", waiting: "بانتظار", cancels: "إلغاءات", newBooking: "حجز جديد", clientName: "اسم العميل", clientPhone: "رقم الموبايل", chooseService: "اختر الخدمة", staff: "الموظف", save: "حفظ", today: "اليوم", upcoming: "القادمة", all: "الكل", searchPh: "بحث بالاسم أو الرقم", noBookings: "مفيش حجوزات", confirmed: "مؤكد", arrivedS: "حضر", cancelled: "ألغى", selfBook: "حجز ذاتي", paid: "دفع ✓", settings: "الإعدادات والدفع", paymentSettings: "طرق استلام الفلوس من العملاء", manualMethods: "اللي هيظهر للعميل عشان يدفعلك", wallet: "رقم محفظة (فودافون كاش...)", bankAcc: "إنستاباي / حساب بنكي", cashOk: "أقبل كاش عند الوصول", saveSettings: "حفظ", savedOk: "اتحفظ ✓", subTitle: "فعّل حسابك", perMonth: "شهرياً", trialBtn: "تجربة مجانية 14 يوم", payInsta: "1️⃣ حوّل على إنستاباي:", iPaid: "حوّلت ✓ ابعت طلب التفعيل", awaiting: "طلبك وصل ✓ في انتظار تأكيد الإدارة (دقايق لساعات)", payCard: "2️⃣ ادفع بالبطاقة فوراً (Paymob)", trialActive: "تجربة مجانية", subActive: "اشتراك فعّال", daysLeft: "يوم متبقي", bookYourSlot: "احجز معادك", confirmBook: "تأكيد الحجز", bookDone: "تم تأكيد حجزك ✓", another: "حجز تاني", back: "رجوع", howPay: "هتدفع للمكان إزاي؟", payVenue: "ادفع كاش عند الوصول", payTo: "حوّل على:", transferred: "حوّلت ✓ أكّد الحجز", noPlaces: "مفيش أماكن مسجلة لسه", subFeatures: ["✓ حجوزات غير محدودة", "✓ رابط حجز + QR لمكانك", "✓ استلام فلوس العملاء على رقمك مباشرة", "✓ شات بوت يرد على عملائك ويعرف حجوزاتهم", "✓ إحصائيات يومية"], chatTitle: "المساعد", chatPh: "اكتب سؤالك أو رقم موبايلك...", chatHi: "أهلاً! 👋 اسألني عن الأماكن والخدمات والعناوين — أو ابعتلي رقم موبايلك وأقولك مواعيد حجوزاتك.", myBookings: "حجوزاتي", enterPhone: "اكتب رقم موبايلك", noneFound: "مفيش حجوزات بالرقم ده", ref: "كود الحجز", shareWa: "ابعت التأكيد واتساب", qrTitle: "QR رابط الحجز — اطبعه وحطه في المكان", adminPanel: "لوحة الإدارة", pendingSubs: "طلبات تفعيل معلقة", allBiz: "كل الأماكن", approve: "تفعيل ✓", reject: "رفض", noPending: "مفيش طلبات معلقة", active: "فعّال", inactive: "غير فعّال", confirmMail: "اتبعتلك رسالة تأكيد على إيميلك — أكّدها وادخل", customLink: "🔗 رابط مخصص", uploadReceipt: "📎 ارفع صورة الإيصال (مطلوب للتفعيل)", stats: "📊 الإحصائيات", totalBookingsToday: "حجوزات اليوم (الكل)", editSub: "✏️ تعديل" },
  ma: { dir: "rtl", appName: "احجزلي", tagline: "نظام ديال الحجوزات", login: "دخول", signup: "حساب جديد", email: "الإيميل", password: "الكود السري", bizName: "سمية المحل", address: "العنوان بالتفصيل", types: { hospital: "سبيطار", clinic: "عيادة", barber: "حلاق", salon: "صالون ديال الزين", dental: "🦷 طبيب الأسنان", dermatology: "🧴 جلدية", eye: "👁️ عيون", veterinary: "🐾 بيطري", physiotherapy: "🏃 علاج طبيعي", gym: "💪 جيم", lawyer: "⚖️ محامي", accountant: "📊 محاسب", car_service: "🚗 ميكانيك", photographer: "📸 مصور", tutor: "📚 أستاذ", language: "🌍 مركز لغات" }, fillAll: "عمّر كاع الخانات", wrongCreds: "المعلومات ماشي صحيحة", createAcc: "دير الحساب", signIn: "دخول", imClient: "أنا كليان وبغيت نحجز", bookLink: "رابط الحجز", copied: "تنسخ ✓", todayBookings: "مواعيد اليوم", arrived: "جاو", waiting: "كيتسناو", cancels: "ملغيين", newBooking: "حجز جديد", clientName: "سمية الكليان", clientPhone: "رقم التيليفون", chooseService: "ختار الخدمة", staff: "الخدّام", save: "سجّل", today: "اليوم", upcoming: "الجايين", all: "كلشي", searchPh: "قلّب", noBookings: "ماكاين حتى حجز", confirmed: "مأكد", arrivedS: "جا", cancelled: "لغى", selfBook: "حجز بوحدو", paid: "خلّص ✓", settings: "الإعدادات والخلاص", paymentSettings: "كيفاش توصلك الفلوس", manualMethods: "اللي غادي يشوفو الكليان", wallet: "رقم Cash Plus / Wafacash", bankAcc: "RIB", cashOk: "كنقبل كاش", saveSettings: "سجّل", savedOk: "تسجّل ✓", subTitle: "فعّل الحساب", perMonth: "فالشهر", trialBtn: "تجربة فابور 14 يوم", payInsta: "1️⃣ حوّل على إنستاباي:", iPaid: "حوّلت ✓ صيفط الطلب", awaiting: "الطلب وصل ✓ تسنى تأكيد الإدارة", payCard: "2️⃣ خلّص بالكارط دابا", trialActive: "تجربة فابور", subActive: "خدّام", daysLeft: "يوم باقي", bookYourSlot: "حجز الموعد", confirmBook: "أكّد", bookDone: "تأكد الحجز ✓", another: "حجز آخر", back: "رجوع", howPay: "كيفاش غادي تخلّص للمحل؟", payVenue: "كاش فالمحل", payTo: "حوّل على:", transferred: "حوّلت ✓ أكّد", noPlaces: "ماكاين حتى محل", subFeatures: ["✓ حجوزات بلا حدود", "✓ رابط + QR", "✓ الفلوس توصلك نيشان", "✓ شات بوت", "✓ إحصائيات"], chatTitle: "المساعد", chatPh: "كتب سؤالك ولا رقمك...", chatHi: "مرحبا! 👋 سولني ولا صيفط رقم التيليفون ديالك نقول ليك مواعيدك.", myBookings: "الحجوزات ديالي", enterPhone: "رقم التيليفون", noneFound: "ماكاين حتى حجز", ref: "كود", shareWa: "صيفط فواتساب", qrTitle: "QR — طبعو", adminPanel: "الإدارة", pendingSubs: "طلبات معلقة", allBiz: "كاع المحلات", approve: "فعّل ✓", reject: "رفض", noPending: "ماكاين طلبات", active: "خدّام", inactive: "ماشي خدّام", confirmMail: "تصيفطات ليك رسالة فالإيميل — أكدها ودخل", customLink: "🔗 رابط مخصص", uploadReceipt: "📎 ارفع صورة الإيصال (مطلوب للتفعيل)", stats: "📊 الإحصائيات", totalBookingsToday: "حجوزات اليوم (كلشي)", editSub: "✏️ تعديل" },
  msa: { dir: "rtl", appName: "احجزلي", tagline: "نظام حجوزات", login: "دخول", signup: "حساب جديد", email: "البريد الإلكتروني", password: "كلمة المرور", bizName: "اسم المنشأة", address: "العنوان", types: { hospital: "مستشفى", clinic: "عيادة", barber: "صالون حلاقة", salon: "صالون تجميل", dental: "🦷 عيادة أسنان", dermatology: "🧴 جلدية", eye: "👁️ عيون", veterinary: "🐾 بيطري", physiotherapy: "🏃 علاج طبيعي", gym: "💪 جيم", lawyer: "⚖️ محامي", accountant: "📊 محاسب", car_service: "🚗 صيانة سيارات", photographer: "📸 مصور", tutor: "📚 مدرّس", language: "🌍 مركز لغات" }, fillAll: "املأ جميع الحقول", wrongCreds: "بيانات غير صحيحة", createAcc: "إنشاء الحساب", signIn: "دخول", imClient: "أنا عميل وأرغب بالحجز", bookLink: "رابط الحجز", copied: "تم النسخ ✓", todayBookings: "مواعيد اليوم", arrived: "حضروا", waiting: "بالانتظار", cancels: "إلغاءات", newBooking: "حجز جديد", clientName: "اسم العميل", clientPhone: "رقم الجوال", chooseService: "اختر الخدمة", staff: "الموظف", save: "حفظ", today: "اليوم", upcoming: "القادمة", all: "الكل", searchPh: "بحث", noBookings: "لا توجد حجوزات", confirmed: "مؤكد", arrivedS: "حضر", cancelled: "ملغى", selfBook: "حجز ذاتي", paid: "مدفوع ✓", settings: "الإعدادات", paymentSettings: "طرق استلام المدفوعات", manualMethods: "ما سيظهر للعميل", wallet: "رقم محفظة", bankAcc: "آيبان / حساب", cashOk: "أقبل النقد", saveSettings: "حفظ", savedOk: "تم ✓", subTitle: "فعّل حسابك", perMonth: "شهرياً", trialBtn: "تجربة مجانية 14 يوماً", payInsta: "1️⃣ حوّل عبر إنستاباي:", iPaid: "حوّلت ✓ أرسل الطلب", awaiting: "وصل طلبك ✓ بانتظار تأكيد الإدارة", payCard: "2️⃣ ادفع بالبطاقة فوراً", trialActive: "تجربة", subActive: "فعّال", daysLeft: "يوم متبقٍ", bookYourSlot: "احجز موعدك", confirmBook: "تأكيد", bookDone: "تم التأكيد ✓", another: "حجز آخر", back: "رجوع", howPay: "كيف ستدفع للمنشأة؟", payVenue: "نقداً عند الوصول", payTo: "حوّل إلى:", transferred: "حوّلت ✓ تأكيد", noPlaces: "لا منشآت بعد", subFeatures: ["✓ حجوزات غير محدودة", "✓ رابط + QR", "✓ المدفوعات تصلك مباشرة", "✓ مساعد آلي", "✓ إحصائيات"], chatTitle: "المساعد", chatPh: "سؤالك أو رقم جوالك...", chatHi: "أهلاً! 👋 اسألني أو أرسل رقم جوالك لأخبرك بمواعيدك.", myBookings: "حجوزاتي", enterPhone: "رقم جوالك", noneFound: "لا حجوزات بهذا الرقم", ref: "رمز الحجز", shareWa: "أرسل عبر واتساب", qrTitle: "QR — اطبعه", adminPanel: "لوحة الإدارة", pendingSubs: "طلبات معلقة", allBiz: "كل المنشآت", approve: "تفعيل ✓", reject: "رفض", noPending: "لا طلبات", active: "فعّال", inactive: "غير فعّال", confirmMail: "أُرسلت رسالة تأكيد لبريدك — أكدها ثم ادخل", customLink: "🔗 رابط مخصص", uploadReceipt: "📎 ارفع صورة الإيصال (مطلوب للتفعيل)", stats: "📊 الإحصائيات", totalBookingsToday: "حجوزات اليوم (الكل)", editSub: "✏️ تعديل" },
  en: { dir: "ltr", appName: "Bookly", tagline: "Booking system", login: "Login", signup: "Sign up", email: "Email", password: "Password", bizName: "Business name", address: "Full address", types: { hospital: "Hospital", clinic: "Clinic", barber: "Barber", salon: "Salon", dental: "🦷 Dental Clinic", dermatology: "🧴 Dermatology", eye: "👁️ Eye Clinic", veterinary: "🐾 Veterinary", physiotherapy: "🏃 Physiotherapy", gym: "💪 Gym", lawyer: "⚖️ Lawyer", accountant: "📊 Accountant", car_service: "🚗 Car Service", photographer: "📸 Photographer", tutor: "📚 Tutor", language: "🌍 Language Center" }, fillAll: "Fill all fields", wrongCreds: "Wrong credentials or unconfirmed email", createAcc: "Create account", signIn: "Sign in", imClient: "I'm a client", bookLink: "Booking link", copied: "Copied ✓", todayBookings: "Today", arrived: "Arrived", waiting: "Waiting", cancels: "Cancelled", newBooking: "New booking", clientName: "Client name", clientPhone: "Phone", chooseService: "Service", staff: "Staff", save: "Save", today: "Today", upcoming: "Upcoming", all: "All", searchPh: "Search", noBookings: "No bookings", confirmed: "Confirmed", arrivedS: "Arrived", cancelled: "Cancelled", selfBook: "Self-booked", paid: "Paid ✓", settings: "Settings", paymentSettings: "How you get paid", manualMethods: "Shown to clients", wallet: "Wallet number", bankAcc: "Bank / IBAN", cashOk: "Cash on arrival OK", saveSettings: "Save", savedOk: "Saved ✓", subTitle: "Activate account", perMonth: "/mo", trialBtn: "14-day free trial", payInsta: "1️⃣ Transfer via InstaPay:", iPaid: "Transferred ✓ Send request", awaiting: "Request sent ✓ awaiting admin approval", payCard: "2️⃣ Pay by card now", trialActive: "Trial", subActive: "Active", daysLeft: "days left", bookYourSlot: "Book a slot", confirmBook: "Confirm", bookDone: "Confirmed ✓", another: "Book another", back: "Back", howPay: "How will you pay the venue?", payVenue: "Cash on arrival", payTo: "Transfer to:", transferred: "Done ✓", noPlaces: "No places yet", subFeatures: ["✓ Unlimited bookings", "✓ Link + QR", "✓ Payments direct to you", "✓ Chatbot", "✓ Stats"], chatTitle: "Assistant", chatPh: "Question or your phone...", chatHi: "Hi! 👋 Ask me anything — or send your phone number to see your bookings.", myBookings: "My bookings", enterPhone: "Your phone", noneFound: "No bookings found", ref: "Code", shareWa: "Send on WhatsApp", qrTitle: "QR — print it", adminPanel: "Admin", pendingSubs: "Pending requests", allBiz: "All businesses", approve: "Approve ✓", reject: "Reject", noPending: "Nothing pending", active: "Active", inactive: "Inactive", confirmMail: "Confirmation email sent — confirm then login", customLink: "🔗 Custom Link", uploadReceipt: "📎 Upload receipt image (required)", stats: "📊 Statistics", totalBookingsToday: "Today's bookings (all)", editSub: "✏️ Edit" },
  fr: { dir: "ltr", appName: "Bookly", tagline: "Réservations", login: "Connexion", signup: "Inscription", email: "Email", password: "Mot de passe", bizName: "Établissement", address: "Adresse", types: { hospital: "Hôpital", clinic: "Clinique", barber: "Coiffeur", salon: "Salon", dental: "🦷 Dentiste", dermatology: "🧴 Dermatologie", eye: "👁️ Ophtalmologie", veterinary: "🐾 Vétérinaire", physiotherapy: "🏃 Kinésithérapie", gym: "💪 Salle de sport", lawyer: "⚖️ Avocat", accountant: "📊 Comptable", car_service: "🚗 Garage auto", photographer: "📸 Photographe", tutor: "📚 Prof particulier", language: "🌍 Centre de langues" }, fillAll: "Remplissez tout", wrongCreds: "Identifiants incorrects", createAcc: "Créer", signIn: "Connexion", imClient: "Je suis client", bookLink: "Lien", copied: "Copié ✓", todayBookings: "Aujourd'hui", arrived: "Arrivés", waiting: "En attente", cancels: "Annulés", newBooking: "Nouveau RDV", clientName: "Nom", clientPhone: "Téléphone", chooseService: "Service", staff: "Employé", save: "Enregistrer", today: "Aujourd'hui", upcoming: "À venir", all: "Tous", searchPh: "Recherche", noBookings: "Aucune réservation", confirmed: "Confirmé", arrivedS: "Arrivé", cancelled: "Annulé", selfBook: "Auto", paid: "Payé ✓", settings: "Paramètres", paymentSettings: "Comment être payé", manualMethods: "Visible aux clients", wallet: "Portefeuille", bankAcc: "RIB", cashOk: "Espèces OK", saveSettings: "Enregistrer", savedOk: "OK ✓", subTitle: "Activez", perMonth: "/mois", trialBtn: "Essai 14 jours", payInsta: "1️⃣ InstaPay :", iPaid: "Viré ✓ Envoyer", awaiting: "Demande envoyée ✓ en attente", payCard: "2️⃣ Carte maintenant", trialActive: "Essai", subActive: "Actif", daysLeft: "jours", bookYourSlot: "Réservez", confirmBook: "Confirmer", bookDone: "Confirmé ✓", another: "Encore", back: "Retour", howPay: "Comment payer ?", payVenue: "Espèces sur place", payTo: "Virer à :", transferred: "Viré ✓", noPlaces: "Aucun établissement", subFeatures: ["✓ Illimité", "✓ Lien + QR", "✓ Paiements directs", "✓ Chatbot", "✓ Stats"], chatTitle: "Assistant", chatPh: "Question ou téléphone...", chatHi: "Bonjour ! 👋 Posez une question ou envoyez votre numéro.", myBookings: "Mes réservations", enterPhone: "Votre numéro", noneFound: "Rien trouvé", ref: "Code", shareWa: "WhatsApp", qrTitle: "QR — imprimez", adminPanel: "Admin", pendingSubs: "Demandes", allBiz: "Tous", approve: "Approuver ✓", reject: "Rejeter", noPending: "Rien", active: "Actif", inactive: "Inactif", confirmMail: "Email de confirmation envoyé", customLink: "🔗 Lien personnalisé", uploadReceipt: "📎 Télécharger le reçu (requis)", stats: "📊 Statistiques", totalBookingsToday: "RDV aujourd'hui (tous)", editSub: "✏️ Modifier" },
};
const SERVICES = {
  hospital: ["كشف", "متابعة", "تحاليل", "أشعة", "طوارئ"],
  clinic: ["كشف", "متابعة", "استشارة", "إجراء"],
  barber: ["قص شعر", "ذقن", "قص + ذقن", "استشوار"],
  salon: ["قص", "صبغة", "مكياج", "بشرة", "مانيكير"],
  dental: ["كشف", "تنظيف", "حشو", "خلع", "تقويم", "تبييض"],
  dermatology: ["كشف", "ليزر", "تقشير", "حقن بوتوكس", "علاج حب الشباب"],
  eye: ["كشف", "قياس نظر", "ليزك", "عمليات", "نظارات"],
  veterinary: ["كشف", "تطعيم", "جراحة", "تجميل", "أشعة"],
  physiotherapy: ["جلسة علاج", "تأهيل", "مساج طبي", "كهرباء", "موجات صوتية"],
  gym: ["اشتراك شهري", "بطولة", "كلاس جماعي", "تغذية", "PT خاص"],
  lawyer: ["استشارة", "قضية مدنية", "قضية جنائية", "عقود", "توثيق"],
  accountant: ["استشارة", "ضرائب", "ميزانية", "مراجعة حسابات", "تأسيس شركة"],
  car_service: ["زيت", "فرامل", "كهرباء", "إطارات", "فحص شامل"],
  photographer: ["جلسة تصوير", "أفراح", "منتجات", "بورتريه", "فيديو"],
  tutor: ["رياضيات", "علوم", "لغة عربية", "إنجليزي", "فيزياء"],
  language: ["إنجليزي", "فرنساوي", "ألماني", "اسباني", "إيطالي"],
};
const today = () => new Date().toISOString().split("T")[0];
const refCode = () => "BK-" + Math.random().toString(36).slice(2, 7).toUpperCase();

// ============ Price parsing from staff field ============
function parsePrice(staffField) {
  if (!staffField) return null;
  const match = staffField.match(/__price__:(\d+)/);
  return match ? match[1] : null;
}
function cleanStaff(staffField) {
  if (!staffField) return "";
  return staffField.replace(/__price__:\d+\|?/, "").trim();
}
function encodeStaffWithPrice(staff, amount) {
  if (!amount) return staff || "";
  if (staff) return `__price__:${amount}|${staff}`;
  return `__price__:${amount}`;
}

// ============ الشات بوت — بيرد على رقم التليفون بمواعيد حقيقية ============
function extractPhone(msg) {
  const m = msg.replace(/[\s-]/g, "").match(/(\+?\d{8,15})/);
  return m ? m[1] : null;
}

function detectLanguage(msg) {
  const m = msg.toLowerCase();
  // Moroccan Darija keywords
  if (/\b(بغيت|بشحال|ديال|شنو|واش|صافي|الزين|دابا|عاود|بلا|فينك|تلغي|الغاء|حجز|موعد|بلاصة|بلايص)\b/.test(m) || m.includes("بغيت") || m.includes("بشحال") || m.includes("ديال") || m.includes("واش") || m.includes("دابا")) {
    if (m.includes("عايز") || m.includes("بكام") || m.includes("ازيك")) return "eg"; // Egyptian overrides
    return "ma";
  }
  // Egyptian Arabic keywords
  if (/\b(عايز|عاوز|بكام|فين|إيه|ايه|عشان|دلوقتي|يا باشا|النهاردة|النهارده|بكرة|بكرا|معاد|معادي|أنا|انا|مش|تلغي|فندم)\b/.test(m) || m.includes("عايز") || m.includes("بكام") || m.includes("النهارده") || m.includes("النهاردة") || m.includes("دلوقتي")) {
    return "eg";
  }
  // French keywords
  if (/\b(bonjour|salut|annuler|facture|tarif|prix|adresse|service|rendez-vous|rdv|merci|oui|non|payer|compte|reservation)\b/.test(m)) {
    return "fr";
  }
  // English keywords
  if (/\b(hi|hello|cancel|invoice|receipt|price|rate|booking|appointment|address|service|thanks|yes|no|payment|cash|card)\b/.test(m)) {
    return "en";
  }
  // Gulf / Levantine / MSA
  if (/\b(أريد|بكم|أين|ماذا|حجز|إلغاء|فاتورة|سعر|عنوان|موعد|تأكيد|نعم|لا|شكرا|مرحبا|المنشأة|المنشاه|المشتركين)\b/.test(m) || m.includes("أريد") || m.includes("أين") || m.includes("إلغاء") || m.includes("فاتورة")) {
    return "msa";
  }
  return null;
}

// Helpers for the state machine
function getSubscriptionInfo(country, lang) {
  const c = getCountry(country);
  if (country === "EG") {
    return lang === "eg" ? `سعر الاشتراك في مصر هو 500 ج.م شهرياً (مع تجربة مجانية 14 يوم) 🎁. تقدر تدفع عن طريق تحويل InstaPay على الرقم ${PLATFORM_INSTAPAY} أو بالفيزا أونلاين (Paymob).` :
           lang === "msa" ? `قيمة الاشتراك في مصر هي 500 ج.م شهرياً (مع تجربة مجانية لمدة 14 يوماً) 🎁. يمكنك الدفع عبر تحويل InstaPay على الرقم ${PLATFORM_INSTAPAY} أو بالبطاقة الائتمانية (Paymob).` :
           `Subscription in Egypt is 500 EGP/month (with a 14-day free trial) 🎁. You can pay via InstaPay to ${PLATFORM_INSTAPAY} or credit card (Paymob).`;
  }
  if (country === "MA") {
    return lang === "ma" ? `سعر الاشتراك في المغرب هو 100 درهم فالشهر (مع تجربة فابور 14 يوم) 🎁. تقدر تخلص بالتحويل البنكي أو بالكارت باناكير أونلاين (Paymob).` :
           lang === "msa" ? `قيمة الاشتراك في المغرب هي 100 درهم شهرياً (مع تجربة مجانية لمدة 14 يوماً) 🎁. يمكنك الدفع عبر التحويل البنكي أو بالبطاقة الائتمانية (Paymob).` :
           `Subscription in Morocco is 100 MAD/month (with a 14-day free trial) 🎁. You can pay via bank virement or credit card (Paymob).`;
  }
  if (["SA", "AE", "KW", "QA", "BH", "OM"].includes(country)) {
    return lang === "en" ? `Subscription in the Gulf region is ~37 AED / 38 SAR / 3 KWD per month (with a 14-day free trial) 🎁. Payment is via online card (Paymob).` :
           `سعر الاشتراك في دول الخليج هو حوالي 37 درهم إماراتي / 38 ريال سعودي / 3 دينار كويتي شهرياً (مع تجربة مجانية 14 يوم) 🎁. الدفع بالبطاقة الائتمانية (Paymob).`;
  }
  return lang === "en" ? `Subscription for other countries is ~$10/month (with a 14-day free trial) 🎁. Payment is via online card (Paymob).` :
         lang === "fr" ? `L'abonnement est de 10 $ / mois avec un essai gratuit de 14 jours ! 🎁 Paiement par carte en ligne (Paymob).` :
         `سعر الاشتراك للدول الأخرى هو حوالي 10 دولارات شهرياً (مع تجربة مجانية 14 يوم) 🎁. الدفع بالفيزا أونلاين (Paymob).`;
}

function getServicePrice(service, bizType, country) {
  const c = getCountry(country);
  let base = 100;
  if (bizType === 'hospital' || bizType === 'clinic') base = 300;
  else if (bizType === 'salon') base = 200;
  else if (bizType === 'barber') base = 100;
  
  if (country === 'EG') return `${base} ${c.cur}`;
  if (country === 'MA' || country === 'DZ' || country === 'TN') return `${Math.round(base / 5)} ${c.cur}`;
  if (['SA', 'AE', 'KW', 'QA', 'BH', 'OM'].includes(country)) return `${Math.round(base / 4)} ${c.cur}`;
  return `${Math.round(base / 10)} ${c.cur}`;
}

function makeInvoiceText(b, lang) {
  const bizName = b.biz_name || b.business_name || "احجزلي";
  const address = b.biz_address || b.address || "العنوان";
  const clientName = b.client_name;
  const phone = b.client_phone;
  const service = b.service;
  const date = b.date;
  const time = String(b.time || "").slice(0, 5);
  const staffRaw = b.staff || "";
  const price = parsePrice(staffRaw);
  const staff = cleanStaff(staffRaw) || (["eg", "ma", "msa"].includes(lang) ? "أي موظف" : (lang === "fr" ? "Tout employé" : "Any staff"));
  const country = b.biz_country || "EG";
  
  const method = b.paid ? 
    (["eg", "ma", "msa"].includes(lang) ? "تحويل / كارت" : (lang === "fr" ? "Carte / Virement" : "Card / Transfer")) :
    (["eg", "ma", "msa"].includes(lang) ? "نقداً عند الوصول (كاش)" : (lang === "fr" ? "Espèces sur place" : "Cash on arrival"));
  const ref = b.ref;

  let priceRow = "";
  if (price) {
    const c = getCountry(country);
    priceRow = `💰 المبلغ: ${price} ${c.cur}\n`;
  }

  return `━━━━━━━━━━━━━━━━━━━━
🧾 فاتورة حجز — احجزلي
━━━━━━━━━━━━━━━━━━━━
👤 الاسم: ${clientName}
📱 الموبايل: ${phone}
━━━━━━━━━━━━━━━━━━━━
🏥 المكان: ${bizName}
📍 العنوان: ${address}
━━━━━━━━━━━━━━━━━━━━
✂️ الخدمة: ${service}
📅 التاريخ: ${date}
⏰ الوقت: ${time}
👤 الموظف: ${staff}
━━━━━━━━━━━━━━━━━━━━
${priceRow}💳 طريقة الدفع: ${method}
🔖 كود الحجز: ${ref}
━━━━━━━━━━━━━━━━━━━━
✅ تم التأكيد
احجزلي — ehgezly.com
━━━━━━━━━━━━━━━━━━━━`;
}

// Tool wrapper implementation
async function check_availability({ business_id, date }) {
  const { data } = await supabase.from("bookings").select("time").eq("business_id", business_id).eq("date", date).neq("status", "cancelled");
  const booked = (data || []).map(b => String(b.time).slice(0, 5));
  const allSlots = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
  return allSlots.filter(s => !booked.includes(s));
}

async function create_booking({ business_id, client_name, client_phone, service, date, time }) {
  const ref = "BK-" + Math.random().toString(36).slice(2, 7).toUpperCase();
  const { error } = await supabase.from("bookings").insert({
    business_id,
    ref,
    client_name,
    client_phone,
    service,
    date,
    time,
    status: "confirmed",
    from_client: true,
    paid: false
  });
  if (error) throw error;
  return { ref };
}

// ============ INVOICE CARD COMPONENT ============
function InvoiceCard({ booking, acc, onClose }) {
  const staffRaw = booking.staff || "";
  const price = parsePrice(staffRaw);
  const staff = cleanStaff(staffRaw);
  const bizName = acc?.business || booking.biz_name || booking.business_name || "احجزلي";
  const address = acc?.address || booking.biz_address || booking.address || "";
  const country = acc?.country || booking.biz_country || "EG";
  const c = getCountry(country);
  const method = booking.paid ? "تحويل / كارت" : "نقداً عند الوصول (كاش)";

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice, #invoice * { visibility: visible; }
          #invoice { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div id="invoice" onClick={e => e.stopPropagation()} dir="rtl" className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full border border-slate-200">
          <div className="text-center border-b-2 border-slate-200 pb-4 mb-4">
            <p className="text-2xl font-bold text-slate-800">🧾 فاتورة حجز</p>
            <p className="text-indigo-600 font-semibold text-sm mt-1">احجزلي</p>
          </div>
          <div className="space-y-2 text-sm text-slate-700 border-b border-slate-100 pb-3 mb-3">
            <div className="flex justify-between"><span>👤 الاسم:</span><span className="font-semibold">{booking.client_name}</span></div>
            <div className="flex justify-between"><span>📱 الموبايل:</span><span className="font-semibold" dir="ltr">{booking.client_phone}</span></div>
          </div>
          <div className="space-y-2 text-sm text-slate-700 border-b border-slate-100 pb-3 mb-3">
            <div className="flex justify-between"><span>🏥 المكان:</span><span className="font-semibold">{bizName}</span></div>
            <div className="flex justify-between"><span>📍 العنوان:</span><span className="font-semibold text-xs">{address}</span></div>
            <div className="flex justify-between"><span>✂️ الخدمة:</span><span className="font-semibold">{booking.service}</span></div>
            <div className="flex justify-between"><span>📅 التاريخ:</span><span className="font-semibold">{booking.date}</span></div>
            <div className="flex justify-between"><span>⏰ الوقت:</span><span className="font-semibold">{String(booking.time || "").slice(0, 5)}</span></div>
          </div>
          <div className="space-y-2 text-sm text-slate-700 border-b border-slate-100 pb-3 mb-3">
            {price && (
              <div className="flex justify-between"><span>💰 المبلغ:</span><span className="font-bold text-green-700">{price} {c.cur}</span></div>
            )}
            <div className="flex justify-between"><span>💳 الدفع:</span><span className="font-semibold">{method}</span></div>
            <div className="flex justify-between"><span>🔖 كود الحجز:</span><span className="font-bold text-indigo-600 font-mono" dir="ltr">{booking.ref}</span></div>
          </div>
          <div className="text-center">
            <p className="text-green-600 font-bold text-lg mb-4">✅ تم التأكيد</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => window.print()} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 transition">🖨️ طباعة</button>
              {onClose && <button onClick={onClose} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-slate-200 transition">إغلاق</button>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============ CHATBOT ============
function ChatBot({ lang: initialLang, ctx }) {
  const [botLang, setBotLang] = useState(initialLang || "eg");
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [session, setSession] = useState(null);
  const endRef = useRef(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // Chatbot booking flow state
  const stepRef = useRef(0);
  const tempBookingRef = useRef({});
  const cachedBusinessesRef = useRef(null);

  const t = STR[botLang] || STR.en;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open, typing]);

  useEffect(() => {
    const greeting = botLang === "eg" ? "أهلاً بك! 👋 أنا مساعدك الذكي لمنصة احجزلي. اقدر أساعدك في حجز موعد، أو الإجابة عن معلومات المكان وعنوانه وأسعاره، أو الاستعلام عن حجزك برقم تليفونك. اسألني أي حاجة!" :
                     botLang === "ma" ? "مرحباً بك! 👋 أنا المساعد الذكي ديال منصة احجزلي. نقدر نعاونك تحجز موعد، نجاوبك على معلومات المحل، العنوان والأسعار، أو تقلب على الحجز ديالك برقم التيليفون. سولني على أي حاجة!" :
                     botLang === "fr" ? "Bienvenue ! 👋 Je suis votre assistant de réservation intelligent pour Ehgezly. Je peux vous aider à réserver un rendez-vous, répondre à vos questions sur les établissements, les services, les prix et les adresses, ou rechercher des réservations par votre numéro de téléphone. Posez-moi vos questions !" :
                     botLang === "en" ? "Welcome! 👋 I am your intelligent booking assistant for Ehgezly. I can help you book an appointment, answer questions about businesses, services, prices, and addresses, or lookup bookings by your phone number. Ask me anything!" :
                     "مرحباً بك! 👋 أنا مساعدك الذكي لمنصة احجزلي. يمكنني مساعدتك في حجز موعد، أو الإجابة عن معلومات المنشأة وعنوانها وأسعارها، أو البحث عن حجوزاتك برقم جوالك. تفضل بسؤالي!";
    setMsgs([{ from: "bot", text: greeting }]);
    setSession(null);
    stepRef.current = 0;
    tempBookingRef.current = {};
    cachedBusinessesRef.current = null;
  }, [botLang]);

  useEffect(() => {
    if (initialLang) {
      setBotLang(initialLang);
    }
  }, [initialLang]);

  async function handleSend(textToSend) {
    const text = textToSend || input;
    if (!text.trim() || typing) return;

    setMsgs(m => [...m, { from: "user", text }]);
    setInput("");
    setTyping(true);

    const detected = detectLanguage(text);
    if (detected) {
      setBotLang(detected);
    }

    try {
      const reply = await botReplyStateful(text, detected || botLang, ctxRef.current, session, setSession, stepRef, tempBookingRef, cachedBusinessesRef);
      setMsgs(m => [...m, { from: "bot", text: reply }]);
    } catch (e) {
      setMsgs(m => [...m, { from: "bot", text: botLang === "eg" || botLang === "ma" || botLang === "msa" ? "في مشكلة مؤقتة، حاول تاني بعد شوية." : "Temporary error, try again later." }]);
    } finally {
      setTyping(false);
    }
  }

  const side = t.dir === "rtl" ? "left-4" : "right-4";

  const getChips = () => {
    if (botLang === "eg") {
      return [
        { label: "حجز موعد 📅", msg: "حجز" },
        { label: "حجوزاتي 🔍", msg: "حجوزاتي" },
        { label: "إلغاء حجز ❌", msg: "إلغاء حجز" },
        { label: "فاتورة 🧾", msg: "عايز فاتورة" },
        { label: "الاشتراك 💳", msg: "أسعار الاشتراك" }
      ];
    }
    if (botLang === "ma") {
      return [
        { label: "حجز موعد 📅", msg: "حجز" },
        { label: "الحجوزات ديالي 🔍", msg: "حجوزاتي" },
        { label: "إلغاء حجز ❌", msg: "إلغاء حجز" },
        { label: "فاتورة 🧾", msg: "فاتورة" },
        { label: "الاشتراك 💳", msg: "بشحال الاشتراك" }
      ];
    }
    if (botLang === "fr") {
      return [
        { label: "Réserver 📅", msg: "book" },
        { label: "Mes RDV 🔍", msg: "mes réservations" },
        { label: "Annuler ❌", msg: "annuler" },
        { label: "Facture 🧾", msg: "facture" },
        { label: "Tarif 💳", msg: "prix" }
      ];
    }
    if (botLang === "en") {
      return [
        { label: "Book 📅", msg: "book" },
        { label: "My Bookings 🔍", msg: "my bookings" },
        { label: "Cancel ❌", msg: "cancel" },
        { label: "Invoice 🧾", msg: "invoice" },
        { label: "Subscription 💳", msg: "subscription price" }
      ];
    }
    return [
      { label: "حجز موعد 📅", msg: "حجز" },
      { label: "حجوزاتي 🔍", msg: "حجوزاتي" },
      { label: "إلغاء حجز ❌", msg: "إلغاء حجز" },
      { label: "فاتورة 🧾", msg: "فاتورة" },
      { label: "الاشتراك 💳", msg: "سعر الاشتراك" }
    ];
  };

  return (
    <>
      <button 
        onClick={() => setOpen(!open)} 
        className={`fixed bottom-4 ${side} bg-gradient-to-tr from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white p-4 rounded-full shadow-2xl z-50 transition-all duration-300 transform hover:scale-110 active:scale-95 flex items-center justify-center`}
      >
        {open ? <X size={24} className="animate-spin-once" /> : <MessageCircle size={24} className="animate-pulse" />}
      </button>
      
      {open && (
        <div 
          dir={t.dir} 
          className={`fixed bottom-20 ${side} w-85 max-w-[calc(100vw-2rem)] bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-100 z-50 flex flex-col overflow-hidden transition-all duration-300 animate-slide-up`} 
          style={{ height: 420 }}
        >
          <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-4 py-3 flex items-center justify-between shadow-md">
            <div className="flex items-center gap-2">
              <MessageCircle size={20} className="animate-bounce" />
              <div>
                <span className="font-bold text-sm tracking-wide">{t.chatTitle || "مساعد احجزلي"}</span>
                {ctx?.acc && <span className="text-[10px] opacity-90 block">· {ctx.acc.business}</span>}
              </div>
            </div>
            {(session || stepRef.current > 0) && (
              <button 
                onClick={() => { setSession(null); stepRef.current = 0; tempBookingRef.current = {}; }} 
                className="bg-white/20 hover:bg-white/30 text-white text-[10px] px-2 py-0.5 rounded-full transition"
              >
                {botLang === "en" ? "Reset" : botLang === "fr" ? "Réinitialiser" : "إعادة تعيين"}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/50">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.from === "user" ? "justify-start" : "justify-end"}`}>
                <div 
                  className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-line ${
                    m.from === "user" 
                      ? "bg-indigo-600 text-white rounded-br-none" 
                      : "bg-white text-slate-700 border border-slate-100 rounded-bl-none"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-100 px-4 py-3 rounded-2xl rounded-bl-none text-sm text-slate-400 flex items-center gap-1 shadow-sm">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="px-3 py-1.5 border-t border-slate-100 flex gap-1.5 overflow-x-auto whitespace-nowrap scrollbar-none bg-white">
            {getChips().map((chip, idx) => (
              <button 
                key={idx} 
                onClick={() => handleSend(chip.msg)} 
                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs px-2.5 py-1 rounded-full border border-indigo-100 transition active:scale-95"
              >
                {chip.label}
              </button>
            ))}
          </div>

          <div className="p-2.5 border-t border-slate-100 flex gap-2 bg-white">
            <input 
              value={input} 
              onChange={e => setInput(e.target.value)} 
              onKeyDown={e => e.key === "Enter" && handleSend()} 
              placeholder={t.chatPh || "اكتب رسالتك هنا..."} 
              className="flex-1 border border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none rounded-xl px-3 py-2 text-sm transition"
            />
            <button 
              onClick={() => handleSend()} 
              className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white p-2.5 rounded-xl hover:shadow-md hover:from-indigo-700 hover:to-violet-700 transition active:scale-95 flex items-center justify-center"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ============ STATEFUL CHATBOT REPLY (Change 5) ============
async function botReplyStateful(msg, currentLang, ctx, session, setSession, stepRef, tempBookingRef, cachedBusinessesRef) {
  const detected = detectLanguage(msg);
  const lang = detected || currentLang || "eg";
  const ar = ["eg", "ma", "msa"].includes(lang);
  const m = msg.trim().toLowerCase();
  const has = (...ks) => ks.some(k => m.includes(k));
  const acc = ctx?.acc || null;

  // Cancel / reset at any step
  if (has("إلغاء", "cancel", "annuler") && stepRef.current > 0 && stepRef.current <= 7) {
    stepRef.current = 0;
    tempBookingRef.current = {};
    return ar ? "تم الإلغاء. كيف أقدر أساعدك؟" : "Cancelled. How can I help you?";
  }

  // Phone number detection works at any step
  const phone = extractPhone(msg);
  if (phone && stepRef.current === 0) {
    try {
      const list = await bookingsByPhone(phone);
      if (!list.length) return ar ? "مفيش حجوزات بالرقم ده — تأكد من الرقم أو سجّل حجز جديد." : "No bookings found for this number.";
      
      const now = new Date();
      let proactiveText = "";
      const soonBooking = list.find(b => {
        if (b.status === "cancelled") return false;
        try {
          const bTime = new Date(`${b.date}T${b.time}`);
          const diffMs = bTime - now;
          return diffMs > 0 && diffMs <= 5400000;
        } catch (e) { return false; }
      });

      if (soonBooking) {
        const formattedTime = String(soonBooking.time).slice(0, 5);
        proactiveText = ar
          ? `تذكير 🔔 عندك حجز في [${soonBooking.biz_name}] بعد ساعة — [${soonBooking.service}] الساعة [${formattedTime}]. العنوان: [${soonBooking.biz_address}]. كود الحجز: [${soonBooking.ref}]\n\n`
          : `Reminder 🔔 You have an appointment at [${soonBooking.biz_name}] in 1 hour — [${soonBooking.service}] at [${formattedTime}]. Address: [${soonBooking.biz_address}]. Ref: [${soonBooking.ref}]\n\n`;
      }

      const lines = list.map((b, index) => {
        let statusStr = "";
        if (ar) {
          statusStr = b.status === "cancelled" ? "❌ ملغى" : b.status === "arrived" ? "✓ حضر" : b.status === "pending" ? "⏳ معلق" : "✅ مؤكد";
        } else if (lang === "fr") {
          statusStr = b.status === "cancelled" ? "❌ Annulé" : b.status === "arrived" ? "✓ Arrivé" : b.status === "pending" ? "⏳ En attente" : "✅ Confirmé";
        } else {
          statusStr = b.status === "cancelled" ? "❌ Cancelled" : b.status === "arrived" ? "✓ Arrived" : b.status === "pending" ? "⏳ Pending" : "✅ Confirmed";
        }
        const timeStr = String(b.time || "").slice(0, 5);
        const typeEmoji = (b.biz_type === "hospital" || b.biz_type === "clinic") ? "🏥" : "✂️";
        return `${index + 1}. ${typeEmoji} ${b.biz_name || "المكان"}\n   📋 ${b.service} | 📅 ${b.date} ⏰ ${timeStr}\n   🔖 كود: ${b.ref} | ${statusStr}\n   📍 ${b.biz_address || "العنوان"}`;
      });

      const title = ar ? "حجوزاتي" : (lang === "fr" ? "Mes réservations" : "My Bookings");
      return proactiveText + title + ":\n\n" + lines.join("\n\n");
    } catch (e) {
      return ar ? "في مشكلة مؤقتة، حاول تاني بعد شوية." : "Temporary issue, please try again later.";
    }
  }

  // ============ STEP-BASED BOOKING FLOW ============

  // Step 1: User says حجز or book → show list of active places
  if (stepRef.current === 0 && has("حجز", "book", "réserver", "حاجز", "موعد")) {
    try {
      const businesses = await activeBusinesses();
      if (!businesses.length) return ar ? "مفيش أماكن مسجلة حالياً." : "No active businesses available.";
      cachedBusinessesRef.current = businesses;
      stepRef.current = 1;
      let text = ar ? "اختر المكان (اكتب الرقم):\n\n" : (lang === "fr" ? "Choisissez l'établissement (tapez le numéro) :\n\n" : "Choose a place (type the number):\n\n");
      businesses.forEach((b, i) => {
        const emoji = STR.eg.types[b.type] || b.type;
        text += `${i + 1}. ${b.business} — ${emoji}\n   📍 ${b.address}\n\n`;
      });
      return text;
    } catch (e) {
      return ar ? "في مشكلة مؤقتة." : "Temporary issue.";
    }
  }

  // Step 2: User picks a place → show services
  if (stepRef.current === 1) {
    const num = parseInt(msg);
    const businesses = cachedBusinessesRef.current || [];
    if (isNaN(num) || num < 1 || num > businesses.length) {
      return ar ? `اكتب رقم من 1 إلى ${businesses.length}` : `Type a number from 1 to ${businesses.length}`;
    }
    const chosen = businesses[num - 1];
    tempBookingRef.current = { business_id: chosen.id, business_name: chosen.business, business_type: chosen.type };
    const services = SERVICES[chosen.type] || SERVICES.clinic;
    stepRef.current = 2;
    let text = ar ? `${chosen.business} 👍\n\nاختر الخدمة (اكتب الرقم):\n\n` : `${chosen.business} 👍\n\nChoose a service (type the number):\n\n`;
    services.forEach((s, i) => {
      text += `${i + 1}. ${s}\n`;
    });
    return text;
  }

  // Step 3: User picks service → ask for date
  if (stepRef.current === 2) {
    const services = SERVICES[tempBookingRef.current.business_type] || SERVICES.clinic;
    const num = parseInt(msg);
    let chosenService = msg;
    if (!isNaN(num) && num >= 1 && num <= services.length) {
      chosenService = services[num - 1];
    } else {
      const matched = services.find(s => m.includes(s.toLowerCase()) || s.toLowerCase().includes(m));
      if (matched) chosenService = matched;
    }
    tempBookingRef.current.service = chosenService;
    stepRef.current = 3;
    return ar ? `${chosenService} ✓\n\nاكتب تاريخ الحجز (مثال: ${today()})` : `${chosenService} ✓\n\nEnter the date (e.g. ${today()})`;
  }

  // Step 4: User enters date → ask for time
  if (stepRef.current === 3) {
    let parsedDate = msg.trim();
    if (has("اليوم", "النهارده", "النهاردة", "today", "aujourd'hui")) {
      parsedDate = today();
    } else if (has("بكرة", "بكره", "بكرا", "tomorrow", "demain")) {
      parsedDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    }
    tempBookingRef.current.date = parsedDate;
    stepRef.current = 4;
    try {
      const slots = await check_availability({ business_id: tempBookingRef.current.business_id, date: parsedDate });
      if (slots.length === 0) {
        return ar ? `مفيش مواعيد متاحة يوم ${parsedDate}. اختار تاريخ تاني.` : `No slots on ${parsedDate}. Choose another date.`;
      }
      return ar ? `الأوقات المتاحة:\n${slots.join(" | ")}\n\nاكتب الوقت (مثال: 14:00)` : `Available times:\n${slots.join(" | ")}\n\nEnter time (e.g. 14:00)`;
    } catch (e) {
      return ar ? "اكتب الوقت (مثال: 14:00)" : "Enter time (e.g. 14:00)";
    }
  }

  // Step 5: User enters time → ask for name and phone
  if (stepRef.current === 4) {
    tempBookingRef.current.time = msg.trim();
    stepRef.current = 5;
    return ar ? "اكتب اسمك ورقمك (مثال: أحمد، 01012345678)" : "Enter your name and phone (e.g. Ahmed, 01012345678)";
  }

  // Step 6: User enters "name, phone" → confirm
  if (stepRef.current === 5) {
    const parts = msg.split(/[,،\s]+/).filter(Boolean);
    let name = "";
    let phoneNum = "";
    for (const p of parts) {
      const extracted = extractPhone(p);
      if (extracted) phoneNum = extracted;
      else if (p.length > 1) name = name ? name + " " + p : p;
    }
    if (!name) name = msg.replace(/[\d+,،]/g, "").trim() || "عميل";
    if (!phoneNum) {
      const extracted = extractPhone(msg);
      if (extracted) phoneNum = extracted;
    }
    tempBookingRef.current.name = name;
    tempBookingRef.current.phone = phoneNum;
    stepRef.current = 6;
    const tb = tempBookingRef.current;
    const confirmText = ar
      ? `تأكيد الحجز:\n📍 ${tb.business_name}\n✂️ ${tb.service}\n📅 ${tb.date}\n⏰ ${tb.time}\n👤 ${tb.name}\n📱 ${tb.phone || "—"}\n\nاكتب "تأكيد" للحجز`
      : `Confirm booking:\n📍 ${tb.business_name}\n✂️ ${tb.service}\n📅 ${tb.date}\n⏰ ${tb.time}\n👤 ${tb.name}\n📱 ${tb.phone || "—"}\n\nType "confirm" to book`;
    return confirmText;
  }

  // Step 7: User writes تأكيد → create booking
  if (stepRef.current === 6) {
    if (has("تأكيد", "confirm", "confirmer", "نعم", "yes", "oui", "اكد", "أكّد", "ok")) {
      try {
        const tb = tempBookingRef.current;
        const clientPhone = tb.phone || "0000000000";
        const res = await create_booking({
          business_id: tb.business_id,
          client_name: tb.name,
          client_phone: clientPhone,
          service: tb.service,
          date: tb.date,
          time: tb.time
        });
        stepRef.current = 0;
        tempBookingRef.current = {};
        return ar
          ? `تم تأكيد حجزك بنجاح! 🎉\nكود الحجز: ${res.ref}`
          : `Booking confirmed! 🎉\nCode: ${res.ref}`;
      } catch (e) {
        stepRef.current = 0;
        tempBookingRef.current = {};
        return ar ? "في مشكلة مؤقتة، حاول تاني بعد شوية." : "Temporary issue, try again.";
      }
    } else {
      stepRef.current = 0;
      tempBookingRef.current = {};
      return ar ? "تم إلغاء طلب الحجز." : "Booking request cancelled.";
    }
  }

  // ============ OLD SESSION-BASED FLOWS (cancellation, invoice) ============
  const updateSession = (newSess) => { setSession(newSess); };

  // Language context strings for old flows
  const strings = {
    eg: { cancelPromptPhone: "عشان ألغي الحجز، اكتبلي رقم الموبايل اللي حجزت بيه.", invoicePromptPhone: "عشان أطلعلك الفاتورة، اكتبلي رقم الموبايل اللي حجزت بيه.", noneFound: "مش لاقي حجوزات بالرقم ده.", selectBooking: "لقيت كذا حجز. اختر رقم الحجز (اكتب 1 أو 2...):\n", cancelSuccess: "تم إلغاء حجزك بنجاح! ❌", cancelKeep: "تم الإبقاء على حجزك. 👍", thanks: "العفو! 🙌", unknown: "مفهمتش 🤔 جرّب: العنوان، الخدمات، أو ابعت رقم موبايلك.", hi: "أهلاً! 👋 اسألني أي حاجة أو ابعت رقمك.", rescheduleInfo: "لتعديل موعد حجزك، يرجى إلغاء الحجز الحالي وعمل حجز جديد.", noPlace: "اختر مكان الأول." },
    ma: { cancelPromptPhone: "كتب ليا رقم التيليفون باش حجزتي.", invoicePromptPhone: "كتب ليا رقم التيليفون باش حجزتي.", noneFound: "ماكاين حجز بهاد الرقم.", selectBooking: "لقيت كذا حجز. ختار الرقم:\n", cancelSuccess: "تلغى الحجز! ❌", cancelKeep: "بقى الحجز. 👍", thanks: "بلا جميل! 🙌", unknown: "ما فهمتش 🤔 جرب العنوان، الخدمات، أو رقمك.", hi: "مرحبا! 👋 سولني أو صيفط رقمك.", rescheduleInfo: "الغي الحجز ودير واحد جديد.", noPlace: "ختار المحل أولاً." },
    msa: { cancelPromptPhone: "لإلغاء الحجز، يرجى كتابة رقم الجوال.", invoicePromptPhone: "لإصدار الفاتورة، يرجى كتابة رقم الجوال.", noneFound: "لم أجد حجز بهذا الرقم.", selectBooking: "وجدت عدة حجوزات. اختر الرقم:\n", cancelSuccess: "تم إلغاء حجزك! ❌", cancelKeep: "تم الإبقاء على حجزك. 👍", thanks: "على الرحب! 🙌", unknown: "عذراً لم أفهم 🤔", hi: "أهلاً! 👋", rescheduleInfo: "يرجى إلغاء الحجز الحالي وتدوين حجز جديد.", noPlace: "يرجى اختيار المنشأة." },
    en: { cancelPromptPhone: "Enter the phone number you booked with.", invoicePromptPhone: "Enter the phone number you booked with.", noneFound: "No bookings found.", selectBooking: "Multiple bookings found. Type a number:\n", cancelSuccess: "Cancelled! ❌", cancelKeep: "Booking kept. 👍", thanks: "You're welcome! 🙌", unknown: "I didn't get that 🤔 Try: address, services, or your phone.", hi: "Hi! 👋 Ask me anything.", rescheduleInfo: "Cancel your current booking and make a new one.", noPlace: "Select a business first." },
    fr: { cancelPromptPhone: "Saisissez le numéro de téléphone utilisé.", invoicePromptPhone: "Saisissez le numéro de téléphone.", noneFound: "Aucune réservation.", selectBooking: "Plusieurs réservations. Tapez un numéro:\n", cancelSuccess: "Annulé! ❌", cancelKeep: "Réservation maintenue. 👍", thanks: "De rien! 🙌", unknown: "Je n'ai pas compris 🤔", hi: "Bonjour! 👋", rescheduleInfo: "Annulez et refaites une réservation.", noPlace: "Sélectionnez un établissement." }
  };
  const s = strings[lang] || strings.eg;

  if (session) {
    // CANCELLATION FLOW
    if (session.type === "cancellation") {
      if (session.step === "phone") {
        const phone = extractPhone(msg);
        if (!phone) return s.cancelPromptPhone;
        try {
          const list = await bookingsByPhone(phone);
          if (!list.length) { updateSession(null); return s.noneFound; }
          if (list.length === 1) {
            const b = list[0];
            const cm = ar ? `هل تريد إلغاء حجز ${b.service} في ${b.biz_name} يوم ${b.date}؟ (نعم/لا)` : `Cancel ${b.service} at ${b.biz_name} on ${b.date}? (yes/no)`;
            updateSession({ type: "cancellation", step: "confirm", phone, booking: b });
            return cm;
          } else {
            let text = s.selectBooking;
            list.forEach((b, i) => { text += `${i + 1}. ${b.biz_name}: ${b.service} (${b.date} ${String(b.time).slice(0, 5)})\n`; });
            updateSession({ type: "cancellation", step: "select", phone, bookings: list });
            return text;
          }
        } catch (e) { updateSession(null); return ar ? "مشكلة مؤقتة." : "Temporary issue."; }
      }
      if (session.step === "select") {
        const num = parseInt(msg);
        if (isNaN(num) || num < 1 || num > session.bookings.length) {
          return s.selectBooking + session.bookings.map((b, i) => `${i + 1}. ${b.biz_name}: ${b.service}`).join("\n");
        }
        const b = session.bookings[num - 1];
        const cm = ar ? `هل تريد إلغاء حجز ${b.service} في ${b.biz_name}؟ (نعم/لا)` : `Cancel ${b.service} at ${b.biz_name}? (yes/no)`;
        updateSession({ type: "cancellation", step: "confirm", phone: session.phone, booking: b });
        return cm;
      }
      if (session.step === "confirm") {
        const yesWords = ["نعم", "آه", "اه", "yes", "oui", "أكّد", "اكد", "ok"];
        if (yesWords.some(w => m.includes(w))) {
          try { await updateBooking(session.booking.id, { status: "cancelled" }); updateSession(null); return s.cancelSuccess; }
          catch (e) { updateSession(null); return ar ? "مشكلة مؤقتة." : "Temporary issue."; }
        } else { updateSession(null); return s.cancelKeep; }
      }
    }

    // INVOICE FLOW
    if (session.type === "invoice") {
      if (session.step === "phone") {
        const phone = extractPhone(msg);
        if (!phone) return s.invoicePromptPhone;
        try {
          const list = await bookingsByPhone(phone);
          if (!list.length) { updateSession(null); return s.noneFound; }
          if (list.length === 1) { const inv = makeInvoiceText(list[0], lang); updateSession(null); return inv; }
          else {
            let text = s.selectBooking;
            list.forEach((b, i) => { text += `${i + 1}. ${b.biz_name}: ${b.service} (${b.date} ${String(b.time).slice(0, 5)})\n`; });
            updateSession({ type: "invoice", step: "select", phone, bookings: list });
            return text;
          }
        } catch (e) { updateSession(null); return ar ? "مشكلة مؤقتة." : "Temporary issue."; }
      }
      if (session.step === "select") {
        const num = parseInt(msg);
        if (isNaN(num) || num < 1 || num > session.bookings.length) {
          return s.selectBooking + session.bookings.map((b, i) => `${i + 1}. ${b.biz_name}: ${b.service}`).join("\n");
        }
        const inv = makeInvoiceText(session.bookings[num - 1], lang);
        updateSession(null);
        return inv;
      }
    }
  }

  // GENERAL INTENTS (step 0)
  if (has("فاتورة", "وصل", "invoice", "receipt", "facture")) {
    updateSession({ type: "invoice", step: "phone" });
    return s.invoicePromptPhone;
  }

  if (has("الغاء", "إلغاء", "cancel", "annul")) {
    updateSession({ type: "cancellation", step: "phone" });
    return s.cancelPromptPhone;
  }

  if (has("تعديل", "تغيير", "reschedule", "modifier")) {
    return s.rescheduleInfo;
  }

  if (has("عنوان", "فين", "وين", "address", "where", "adresse")) {
    return acc ? `📍 ${acc.address}` : s.noPlace;
  }

  if (has("خدمات", "service", "propose")) {
    return acc ? `${acc.business}: ${(SERVICES[acc.type] || []).join("، ")}` : s.noPlace;
  }

  if (has("سعر", "بكام", "بشحال", "اشتراك", "price", "prix")) {
    const c = getCountry(acc?.country || "EG");
    return getSubscriptionInfo(c.c, lang);
  }

  if (has("دفع", "خلاص", "كاش", "pay", "cash")) {
    if (!acc) return s.noPlace;
    return ar ? "كاش عند الوصول أو تحويل على محفظة/حساب المكان." : "Cash on arrival or transfer to the venue's wallet/bank.";
  }

  if (has("شكرا", "thank", "merci")) return s.thanks;
  if (has("مرحبا", "اهلا", "سلام", "hello", "hi", "bonjour")) return s.hi;

  return s.unknown;
}

// ============ APP ============
export default function App() {
  const [view, setView] = useState("loading");
  const [biz, setBiz] = useState(null);
  const [clientCtx, setClientCtx] = useState(null);
  const lang = biz ? getCountry(biz.country).l : (clientCtx?.acc ? getCountry(clientCtx.acc.country).l : "eg");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const b = await myBusiness();
        setBiz(b);
        if (b?.role === "admin") setView("admin");
        else if (b?.sub_until && b.sub_until >= today()) setView("dashboard");
        else if (b) setView("subscribe");
        else setView("auth");
      } else setView("auth");
    });
    const params = new URLSearchParams(window.location.search);
    if (params.get("book")) setView("client");
  }, []);

  const logout = async () => { await signOutUser(); setBiz(null); setView("auth"); };

  if (view === "loading") return <Center dir="rtl"><Loader2 className="animate-spin text-indigo-600" size={28} /></Center>;
  if (view === "client") return <><ClientBooking onBack={() => setView("auth")} onCtx={setClientCtx} /><ChatBot lang={lang} ctx={clientCtx} /></>;
  if (view === "admin" && biz) return <><AdminPanel biz={biz} onLogout={logout} /><ChatBot lang="eg" ctx={null} /></>;
  if (view === "subscribe" && biz) return <><Subscribe biz={biz} onDone={async () => { const b = await myBusiness(); setBiz(b); if (b.sub_until >= today()) setView("dashboard"); }} onLogout={logout} /><ChatBot lang={lang} ctx={{ acc: biz }} /></>;
  if (view === "dashboard" && biz) return <><Dashboard biz={biz} setBiz={setBiz} onLogout={logout} /><ChatBot lang={lang} ctx={{ acc: biz }} /></>;
  return <><Auth onAuth={async () => { const b = await myBusiness(); setBiz(b); if (b?.role === "admin") setView("admin"); else if (b?.sub_until && b.sub_until >= today()) setView("dashboard"); else setView("subscribe"); }} onClientView={() => setView("client")} /><ChatBot lang="eg" ctx={null} /></>;
}

// ============ AUTH (إيميل + باسورد حقيقي عبر Supabase) ============
function Auth({ onAuth, onClientView }) {
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ business: "", type: "clinic", country: "EG", address: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const lang = mode === "signup" ? getCountry(f.country).l : "eg";
  const t = STR[lang];

  async function submit() {
    setErr(""); setInfo(""); setBusy(true);
    try {
      if (mode === "signup") {
        if (!f.business.trim() || !f.email.trim() || !f.password || !f.address.trim()) { setErr(t.fillAll); setBusy(false); return; }
        await signUp(f.email.trim(), f.password, f);
        setInfo(t.confirmMail); setMode("login");
      } else {
        await signIn(f.email.trim(), f.password);
        onAuth();
      }
    } catch (e) { setErr(t.wrongCreds + " — " + (e.message || "")); }
    setBusy(false);
  }

  return (
    <Center dir={t.dir}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-5">
          <div className="bg-indigo-600 p-3 rounded-2xl mb-3"><Calendar className="text-white" size={26} /></div>
          <h1 className="text-xl font-bold text-slate-800">{t.appName}</h1>
          <p className="text-xs text-slate-500 text-center mt-1">{t.tagline}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex bg-slate-100 rounded-xl p-1 mb-4">
            {[["login", t.login], ["signup", t.signup]].map(([k, l]) => (
              <button key={k} onClick={() => { setMode(k); setErr(""); }} className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === k ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"}`}>{l}</button>
            ))}
          </div>
          <div className="space-y-3">
            {mode === "signup" && <>
              <select value={f.country} onChange={e => setF({ ...f, country: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white">
                {COUNTRIES.map(c => <option key={c.c} value={c.c}>{c.f} {c.n}</option>)}
              </select>
              <input value={f.business} onChange={e => setF({ ...f, business: e.target.value })} placeholder={t.bizName} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              <select value={f.type} onChange={e => setF({ ...f, type: e.target.value })} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white">
                {Object.entries(t.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <textarea value={f.address} onChange={e => setF({ ...f, address: e.target.value })} placeholder={t.address} rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
            </>}
            <input type="email" dir="ltr" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder={t.email} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} placeholder={t.password} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            {err && <p className="text-xs text-red-500">{err}</p>}
            {info && <p className="text-xs text-green-600">{info}</p>}
            <button onClick={submit} disabled={busy} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
              {busy && <Loader2 className="animate-spin" size={16} />}{mode === "login" ? t.signIn : t.createAcc}
            </button>
          </div>
        </div>
        <button onClick={onClientView} className="w-full mt-4 text-sm text-indigo-600 flex items-center justify-center gap-1"><Link2 size={15} /> {t.imClient}</button>
      </div>
    </Center>
  );
}

// ============ SUBSCRIBE — مع رفع إيصال (Change 7) ============
function Subscribe({ biz, onDone, onLogout }) {
  const c = getCountry(biz.country);
  const t = STR[c.l];
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [copiedNum, setCopiedNum] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  async function handleReceiptUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadErr("");
    try {
      const url = await uploadReceipt(file, biz.id);
      setReceiptUrl(url);
    } catch (err) {
      setUploadErr(err.message || "Upload failed");
    }
    setUploading(false);
  }

  return (
    <Center dir={t.dir}>
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 text-center">
          <div className="bg-amber-100 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"><Crown className="text-amber-600" size={26} /></div>
          <h2 className="font-bold text-slate-800 mb-1">{t.subTitle}</h2>
          <div className="text-3xl font-bold text-indigo-600 my-3">{c.p} <span className="text-base">{c.cur}</span><span className="text-sm text-slate-400 font-normal"> {t.perMonth}</span></div>
          <ul className={`text-sm text-slate-600 space-y-1.5 mb-5 ${t.dir === "rtl" ? "text-right" : "text-left"}`}>
            {t.subFeatures.map(x => <li key={x}>{x}</li>)}
          </ul>

          <button onClick={async () => { setBusy(true); await startTrial(biz.id); setBusy(false); onDone(); }} disabled={busy} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl text-sm font-medium mb-3">{t.trialBtn}</button>

          {/* خيار 1: إنستاباي يدوي → طلب موافقة الأدمن */}
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 mb-2 text-start">
            <p className="text-xs font-medium text-emerald-700 mb-1">💸 {t.payInsta}</p>
            <button onClick={() => { navigator.clipboard?.writeText(PLATFORM_INSTAPAY).catch(() => {}); setCopiedNum(true); setTimeout(() => setCopiedNum(false), 1500); }} dir="ltr" className="font-mono text-lg font-bold text-emerald-800 tracking-wider w-full text-center">{PLATFORM_INSTAPAY} {copiedNum ? "✓" : "📋"}</button>
            
            {/* Receipt Upload */}
            <div className="mt-3 mb-2">
              <label className="block text-xs text-emerald-700 font-medium mb-1">{t.uploadReceipt}</label>
              <input type="file" accept="image/*" onChange={handleReceiptUpload} className="w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-emerald-100 file:text-emerald-700 hover:file:bg-emerald-200" />
              {uploading && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Loader2 className="animate-spin" size={12} /> جاري الرفع...</p>}
              {receiptUrl && <p className="text-xs text-green-700 mt-1">✓ تم رفع الإيصال بنجاح</p>}
              {uploadErr && <p className="text-xs text-red-500 mt-1">{uploadErr}</p>}
            </div>

            {sent ? <p className="text-xs text-emerald-700 mt-2 text-center">✓ {t.awaiting}</p> : (
              <button onClick={async () => { setBusy(true); try { await requestSub(biz.id, biz.business, biz.country, "instapay", receiptUrl); setSent(true); } catch (e) { alert(e.message); } setBusy(false); }} disabled={busy || !receiptUrl} className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium">{t.iPaid}</button>
            )}
          </div>

          {/* خيار 2: بطاقة عبر Paymob */}
          <button onClick={() => paymobCheckout(biz.id, c.cents)} disabled={busy} className="w-full bg-white border border-indigo-200 text-indigo-600 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
            <CreditCard size={16} /> {t.payCard}
          </button>
        </div>
        <button onClick={onLogout} className="w-full mt-4 text-sm text-slate-500">{t.back}</button>
      </div>
    </Center>
  );
}

// ============ ADMIN PANEL (Change 6 — Full Upgrade) ============
function AdminPanel({ biz, onLogout }) {
  const t = STR.eg;
  const [tab, setTab] = useState("pending");
  const [pending, setPending] = useState(null);
  const [all, setAll] = useState(null);
  const [notifCount, setNotifCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [receiptModal, setReceiptModal] = useState(null);
  const [totalBookingsToday, setTotalBookingsToday] = useState(0);
  const [editingBiz, setEditingBiz] = useState(null);
  const [editDate, setEditDate] = useState("");
  const [invoiceModal, setInvoiceModal] = useState(null);

  async function load() {
    setPending(await adminPendingSubs());
    setAll(await adminAllBusinesses());
    // Count today's bookings across ALL businesses
    try {
      const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true }).eq("date", today());
      setTotalBookingsToday(count || 0);
    } catch (e) {
      setTotalBookingsToday(0);
    }
  }
  useEffect(() => { load(); }, []);

  // Real-time notification bell (Change 6A)
  useEffect(() => {
    const channel = supabase.channel('admin-notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sub_requests' },
        (payload) => {
          setNotifCount(n => n + 1);
          setToasts(t => [...t, `🔔 طلب جديد من مكان جديد`]);
          load(); // reload data
        })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // Auto-dismiss toasts after 4 seconds
  useEffect(() => {
    if (toasts.length > 0) {
      const timer = setTimeout(() => {
        setToasts(t => t.slice(1));
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toasts]);

  async function handleEditSub(bizId) {
    if (!editDate) return;
    try {
      await updateBusiness(bizId, { sub_until: editDate });
      setEditingBiz(null);
      setEditDate("");
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  if (pending === null) return <Center dir="rtl"><Loader2 className="animate-spin text-indigo-600" size={28} /></Center>;

  const activeCount = (all || []).filter(b => b.sub_until >= today()).length;

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 p-4" style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Toasts */}
      <div className="fixed top-4 left-4 right-4 z-50 flex flex-col gap-2 items-center pointer-events-none">
        {toasts.map((toast, i) => (
          <div key={i} className="bg-indigo-600 text-white px-4 py-2 rounded-xl shadow-lg text-sm animate-bounce pointer-events-auto">
            {toast}
          </div>
        ))}
      </div>

      {/* Receipt Modal */}
      {receiptModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setReceiptModal(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl p-4 max-w-lg w-full">
            <img src={receiptModal} alt="receipt" className="w-full rounded-xl" />
            <button onClick={() => setReceiptModal(null)} className="mt-3 w-full bg-slate-100 text-slate-600 py-2 rounded-xl text-sm">إغلاق</button>
          </div>
        </div>
      )}

      {/* Invoice Modal */}
      {invoiceModal && (
        <InvoiceCard booking={invoiceModal} acc={null} onClose={() => setInvoiceModal(null)} />
      )}

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="bg-slate-800 p-2 rounded-xl"><Shield className="text-white" size={20} /></div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">{t.adminPanel}</h1>
              <p className="text-[11px] text-slate-500">{biz.business}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Notification bell */}
            <button onClick={() => { setNotifCount(0); setTab("pending"); }} className="relative bg-white border border-slate-200 text-slate-600 p-2 rounded-xl">
              <span className="text-lg">🔔</span>
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold animate-pulse">
                  {notifCount}
                </span>
              )}
            </button>
            <button onClick={onLogout} className="bg-white border border-slate-200 text-slate-500 p-2 rounded-xl"><LogOut size={16} /></button>
          </div>
        </div>

        {/* Stats Cards (Change 6C) */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <StatCard icon={<Users size={18} />} label="إجمالي الأماكن" value={(all || []).length} color="bg-indigo-50 text-indigo-600" />
          <StatCard icon={<Check size={18} />} label="فعّالة" value={activeCount} color="bg-green-50 text-green-600" />
          <StatCard icon={<Calendar size={18} />} label={t.totalBookingsToday} value={totalBookingsToday} color="bg-amber-50 text-amber-600" />
        </div>

        <div className="flex bg-white rounded-xl p-1 shadow-sm border w-fit mb-4">
          {[["pending", t.pendingSubs], ["all", t.allBiz], ["stats", t.stats]].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === k ? "bg-slate-800 text-white" : "text-slate-500"}`}>{lbl}</button>
          ))}
        </div>

        {tab === "stats" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <StatCard icon={<Users size={18} />} label="إجمالي الأماكن" value={(all || []).length} color="bg-indigo-50 text-indigo-600" />
              <StatCard icon={<Check size={18} />} label="فعّالة" value={activeCount} color="bg-green-50 text-green-600" />
              <StatCard icon={<TrendingUp size={18} />} label="حجوزات اليوم" value={totalBookingsToday} color="bg-purple-50 text-purple-600" />
            </div>
            <div className="bg-white rounded-2xl p-5 shadow-sm border">
              <h3 className="font-semibold text-slate-700 mb-2">ملخص</h3>
              <div className="text-sm text-slate-600 space-y-1">
                <p>• عدد الأماكن الكلي: {(all || []).length}</p>
                <p>• الأماكن الفعّالة: {activeCount}</p>
                <p>• الأماكن غير الفعّالة: {(all || []).length - activeCount}</p>
                <p>• طلبات معلقة: {(pending || []).length}</p>
                <p>• حجوزات اليوم (كل الأماكن): {totalBookingsToday}</p>
              </div>
            </div>
          </div>
        ) : tab === "pending" ? (
          <div className="space-y-3">
            {pending.length === 0 && <div className="text-center py-10 text-slate-400 bg-white rounded-2xl border">{t.noPending}</div>}
            {pending.map(r => (
              <div key={r.id} className="bg-white rounded-2xl p-4 shadow-sm border">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800">{r.businesses?.business} {getCountry(r.businesses?.country).f}</p>
                    <p className="text-xs text-slate-500">{r.businesses?.address}</p>
                    <p className="text-[11px] text-slate-400 mt-1">💸 {r.method || "إنستاباي"} · {new Date(r.created_at).toLocaleString("ar-EG")}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Receipt viewer (Change 6B) */}
                    {r.receipt_url && (
                      <button onClick={() => setReceiptModal(r.receipt_url)} className="bg-blue-50 text-blue-600 px-2 py-2 rounded-lg text-xs font-medium">📎 عرض الإيصال</button>
                    )}
                    <button onClick={async () => { await adminApprove(r.id, r.businesses.id); load(); }} className="bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-medium">{t.approve}</button>
                    <button onClick={async () => { await adminReject(r.id); load(); }} className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-xs font-medium">{t.reject}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {(all || []).map(b => (
              <div key={b.id} className="bg-white rounded-xl p-3 shadow-sm border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-slate-800">{getCountry(b.country).f} {b.business} <span className="text-xs font-normal text-slate-400">({STR.eg.types[b.type] || b.type})</span></p>
                    <p className="text-[11px] text-slate-400">{b.address}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${b.sub_until >= today() ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                      {b.sub_until >= today() ? `${t.active} → ${b.sub_until}` : t.inactive}
                    </span>
                    {/* Manual subscription editor (Change 6D) */}
                    <button onClick={() => { setEditingBiz(editingBiz === b.id ? null : b.id); setEditDate(b.sub_until || ""); }} className="bg-slate-50 text-slate-500 px-2 py-1 rounded-lg text-xs hover:bg-slate-100">{t.editSub}</button>
                  </div>
                </div>
                {editingBiz === b.id && (
                  <div className="mt-2 flex items-center gap-2 bg-slate-50 p-2 rounded-lg">
                    <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm flex-1" />
                    <button onClick={() => handleEditSub(b.id)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium">حفظ</button>
                    <button onClick={() => { setEditingBiz(null); setEditDate(""); }} className="bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-xs">إلغاء</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ DASHBOARD (Change 1 custom link, Change 3 realtime, invoice button) ============
function Dashboard({ biz, setBiz, onLogout }) {
  const c = getCountry(biz.country);
  const t = STR[c.l];
  const [tab, setTab] = useState("bookings");
  const [bookings, setBookings] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("today");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", service: "", staff: "", date: today(), time: "" });
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [pay, setPay] = useState({ wallet: biz.wallet || "", bank: biz.bank || "", cash_ok: biz.cash_ok !== false });
  const [saved, setSaved] = useState(false);
  const [showCustomLink, setShowCustomLink] = useState(false);
  const [customLinkForm, setCustomLinkForm] = useState({ client: "", service: "", amount: "" });
  const [customLinkCopied, setCustomLinkCopied] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null);
  const services = SERVICES[biz.type] || SERVICES.clinic;
  const bookUrl = `${window.location.origin}?book=${biz.id}`;

  // Change 3: Realtime Dashboard
  const load = async () => setBookings(await getBookings(biz.id));
  useEffect(() => {
    load(); // initial load

    const channel = supabase
      .channel(`bk-${biz.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings', filter: `business_id=eq.${biz.id}` },
        (payload) => setBookings(prev => [...(prev || []), payload.new]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `business_id=eq.${biz.id}` },
        (payload) => setBookings(prev => (prev || []).map(b => b.id === payload.new.id ? payload.new : b)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bookings', filter: `business_id=eq.${biz.id}` },
        (payload) => setBookings(prev => (prev || []).filter(b => b.id !== payload.old.id)))
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [biz.id]);

  const filtered = useMemo(() => {
    if (!bookings) return [];
    let list = [...bookings];
    if (filter === "today") list = list.filter(b => b.date === today());
    else if (filter === "upcoming") list = list.filter(b => b.date >= today());
    if (search.trim()) { const s = search.trim(); list = list.filter(b => b.client_name.includes(s) || b.client_phone.includes(s)); }
    return list;
  }, [bookings, filter, search]);

  const stats = useMemo(() => {
    if (!bookings) return { total: 0, arrived: 0, confirmed: 0, cancelled: 0 };
    const td = bookings.filter(b => b.date === today());
    return { total: td.length, arrived: td.filter(b => b.status === "arrived").length, confirmed: td.filter(b => b.status === "confirmed").length, cancelled: td.filter(b => b.status === "cancelled").length };
  }, [bookings]);

  async function add() {
    if (!form.name || !form.phone || !form.service || !form.time) return;
    await addBooking({ business_id: biz.id, ref: refCode(), client_name: form.name, client_phone: form.phone, service: form.service, staff: form.staff, date: form.date, time: form.time });
    setForm({ name: "", phone: "", service: "", staff: "", date: today(), time: "" });
    setShowForm(false); load();
  }
  const setStatus = async (id, status) => { await updateBooking(id, { status }); load(); };
  const remove = async (id) => { await deleteBooking(id); load(); };
  async function saveSettings() {
    await updateBusiness(biz.id, pay);
    setBiz({ ...biz, ...pay });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  // Custom link generation
  function generateCustomLink() {
    const params = new URLSearchParams();
    params.set("book", biz.id);
    if (customLinkForm.client) params.set("client", customLinkForm.client);
    if (customLinkForm.service) params.set("service", customLinkForm.service);
    if (customLinkForm.amount) params.set("amount", customLinkForm.amount);
    return `${window.location.origin}?${params.toString()}`;
  }

  function copyCustomLink() {
    const link = generateCustomLink();
    navigator.clipboard?.writeText(link).catch(() => {});
    setCustomLinkCopied(true);
    setTimeout(() => setCustomLinkCopied(false), 2000);
  }

  const TypeIcon = biz.type === "hospital" || biz.type === "clinic" ? Stethoscope : Scissors;
  const daysLeft = biz.sub_until ? Math.max(0, Math.ceil((new Date(biz.sub_until) - new Date()) / 86400000)) : 0;
  const statusStyle = {
    confirmed: { label: t.confirmed, cls: "bg-blue-100 text-blue-700" },
    arrived: { label: t.arrivedS, cls: "bg-green-100 text-green-700" },
    cancelled: { label: t.cancelled, cls: "bg-red-100 text-red-600" },
  };

  if (bookings === null) return <Center dir={t.dir}><Loader2 className="animate-spin text-indigo-600" size={28} /></Center>;

  return (
    <div dir={t.dir} className="min-h-screen bg-slate-50 p-4 pb-24" style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Invoice Modal */}
      {invoiceModal && (
        <InvoiceCard booking={invoiceModal} acc={biz} onClose={() => setInvoiceModal(null)} />
      )}

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-xl"><TypeIcon className="text-white" size={20} /></div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">{biz.business}</h1>
              <p className="text-[11px] text-slate-500">{t.types[biz.type] || biz.type} · {c.f} · <span className="text-green-600">{biz.is_trial ? t.trialActive : t.subActive} ({daysLeft} {t.daysLeft})</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowQR(!showQR)} className="bg-white border border-slate-200 text-slate-600 p-2 rounded-xl"><QrCode size={16} /></button>
            <button onClick={() => { navigator.clipboard?.writeText(bookUrl).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="bg-white border border-indigo-200 text-indigo-600 px-3 py-2 rounded-xl flex items-center gap-1 text-xs font-medium">
              <Link2 size={14} /> {copied ? t.copied : t.bookLink}
            </button>
            {/* Custom Link Button (Change 1) */}
            <button onClick={() => setShowCustomLink(!showCustomLink)} className="bg-white border border-violet-200 text-violet-600 px-3 py-2 rounded-xl flex items-center gap-1 text-xs font-medium">
              {t.customLink}
            </button>
            <button onClick={onLogout} className="bg-white border border-slate-200 text-slate-500 p-2 rounded-xl"><LogOut size={16} /></button>
          </div>
        </div>

        {/* Custom Link Modal (Change 1) */}
        {showCustomLink && (
          <div className="bg-white rounded-2xl p-4 mb-4 shadow-sm border border-violet-100">
            <h3 className="font-semibold text-sm text-violet-700 mb-3">{t.customLink}</h3>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <input value={customLinkForm.client} onChange={e => setCustomLinkForm({ ...customLinkForm, client: e.target.value })} placeholder={t.clientName} className="border border-slate-200 rounded-lg px-2 py-2 text-sm" />
              <select value={customLinkForm.service} onChange={e => setCustomLinkForm({ ...customLinkForm, service: e.target.value })} className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white">
                <option value="">{t.chooseService}</option>
                {services.map(s => <option key={s}>{s}</option>)}
              </select>
              <input type="number" value={customLinkForm.amount} onChange={e => setCustomLinkForm({ ...customLinkForm, amount: e.target.value })} placeholder={`💰 ${c.cur}`} className="border border-slate-200 rounded-lg px-2 py-2 text-sm" dir="ltr" />
            </div>
            <div className="flex gap-2">
              <button onClick={copyCustomLink} className="bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {customLinkCopied ? "✓ تم النسخ" : "📋 نسخ الرابط"}
              </button>
              <p className="text-[10px] text-slate-400 flex-1 flex items-center break-all" dir="ltr">{generateCustomLink()}</p>
            </div>
          </div>
        )}

        {showQR && (
          <div className="bg-white rounded-2xl p-4 mb-4 shadow-sm border text-center">
            <p className="text-xs text-slate-500 mb-2">{t.qrTitle}</p>
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(bookUrl)}`} alt="QR" className="mx-auto rounded-lg" width="180" height="180" />
            <p dir="ltr" className="text-[10px] text-slate-400 mt-2 break-all">{bookUrl}</p>
          </div>
        )}

        <div className="flex bg-white rounded-xl p-1 shadow-sm border mb-4 w-fit">
          {[["bookings", t.todayBookings, Calendar], ["settings", t.settings, Settings]].map(([k, lbl, Ic]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 ${tab === k ? "bg-indigo-600 text-white" : "text-slate-500"}`}><Ic size={15} />{lbl}</button>
          ))}
        </div>

        {tab === "settings" ? (
          <div className="bg-white rounded-2xl p-5 shadow-sm border space-y-4">
            <h3 className="font-semibold text-slate-700 flex items-center gap-2"><Wallet size={17} /> {t.paymentSettings}</h3>
            <p className="text-xs text-slate-400">{t.manualMethods}</p>
            <input value={pay.wallet} onChange={e => setPay({ ...pay, wallet: e.target.value })} placeholder={t.wallet} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" dir="ltr" />
            <input value={pay.bank} onChange={e => setPay({ ...pay, bank: e.target.value })} placeholder={t.bankAcc} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" dir="ltr" />
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={pay.cash_ok} onChange={e => setPay({ ...pay, cash_ok: e.target.checked })} className="rounded" /> {t.cashOk}
            </label>
            <button onClick={saveSettings} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium">{saved ? t.savedOk : t.saveSettings}</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <StatCard icon={<Calendar size={18} />} label={t.todayBookings} value={stats.total} color="bg-indigo-50 text-indigo-600" />
              <StatCard icon={<Check size={18} />} label={t.arrived} value={stats.arrived} color="bg-green-50 text-green-600" />
              <StatCard icon={<Clock size={18} />} label={t.waiting} value={stats.confirmed} color="bg-blue-50 text-blue-600" />
              <StatCard icon={<TrendingUp size={18} />} label={t.cancels} value={stats.cancelled} color="bg-red-50 text-red-500" />
            </div>
            <button onClick={() => setShowForm(!showForm)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-1 text-sm font-medium mb-4"><Plus size={18} /> {t.newBooking}</button>
            {showForm && (
              <div className="bg-white rounded-2xl p-4 mb-4 shadow-sm border">
                <div className="grid grid-cols-2 gap-3">
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t.clientName} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder={t.clientPhone} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" dir="ltr" />
                  <select value={form.service} onChange={e => setForm({ ...form, service: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">{t.chooseService}</option>{services.map(s => <option key={s}>{s}</option>)}
                  </select>
                  <input value={form.staff} onChange={e => setForm({ ...form, staff: e.target.value })} placeholder={t.staff} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <button onClick={add} className="mt-3 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium">{t.save}</button>
              </div>
            )}
            <div className="flex items-center gap-2 mb-4">
              <div className="flex bg-white rounded-xl p-1 shadow-sm border">
                {[["today", t.today], ["upcoming", t.upcoming], ["all", t.all]].map(([k, lbl]) => (
                  <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === k ? "bg-indigo-600 text-white" : "text-slate-500"}`}>{lbl}</button>
                ))}
              </div>
              <div className="flex-1 relative">
                <Search size={16} className={`absolute ${t.dir === "rtl" ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 text-slate-400`} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t.searchPh} className={`w-full bg-white border rounded-xl ${t.dir === "rtl" ? "pr-9 pl-3" : "pl-9 pr-3"} py-2 text-sm shadow-sm`} />
              </div>
            </div>
            <div className="space-y-3">
              {filtered.length === 0 && <div className="text-center py-12 text-slate-400 bg-white rounded-2xl border">{t.noBookings}</div>}
              {filtered.map(b => {
                const priceFromStaff = parsePrice(b.staff);
                const cleanedStaff = cleanStaff(b.staff);
                return (
                  <div key={b.id} className="bg-white rounded-2xl p-4 shadow-sm border flex items-center gap-4">
                    <div className="text-center min-w-[58px]">
                      <div className="text-lg font-bold text-indigo-600">{String(b.time).slice(0, 5)}</div>
                      <div className="text-[11px] text-slate-400">{b.date === today() ? t.today : b.date}</div>
                    </div>
                    <div className="w-px h-12 bg-slate-100" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800">{b.client_name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${(statusStyle[b.status] || statusStyle.confirmed).cls}`}>{(statusStyle[b.status] || statusStyle.confirmed).label}</span>
                        {b.from_client && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">{t.selfBook}</span>}
                        {b.paid && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600">{t.paid}</span>}
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-mono" dir="ltr">{b.ref}</span>
                        {priceFromStaff && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">💰 {priceFromStaff} {c.cur}</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                        <span>{b.service}</span>{cleanedStaff && <span className="flex items-center gap-1"><User size={12} /> {cleanedStaff}</span>}
                        <span className="flex items-center gap-1"><Phone size={12} /> <span dir="ltr">{b.client_phone}</span></span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Invoice button */}
                      <button onClick={() => setInvoiceModal(b)} className="p-2 rounded-lg bg-indigo-50 text-indigo-600" title="فاتورة">🧾</button>
                      {b.status !== "arrived" && <button onClick={() => setStatus(b.id, "arrived")} className="p-2 rounded-lg bg-green-50 text-green-600"><Check size={16} /></button>}
                      {b.status !== "cancelled" && <button onClick={() => setStatus(b.id, "cancelled")} className="p-2 rounded-lg bg-red-50 text-red-500"><X size={16} /></button>}
                      <button onClick={() => remove(b.id)} className="p-2 rounded-lg bg-slate-50 text-slate-400"><Trash2 size={16} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============ CLIENT BOOKING (Change 1 params + Change 2 invoice) ============
function ClientBooking({ onBack, onCtx }) {
  const params = new URLSearchParams(window.location.search);
  const preselect = params.get("book");
  const paramClient = params.get("client") || "";
  const paramService = params.get("service") || "";
  const paramAmount = params.get("amount") || "";
  const [places, setPlaces] = useState(null);
  const [accId, setAccId] = useState(preselect || "");
  const [mode, setMode] = useState("browse");
  const [form, setForm] = useState({ name: paramClient, phone: "", service: paramService, date: today(), time: "", amount: paramAmount });
  const [busy, setBusy] = useState(false);
  const [lastRef, setLastRef] = useState("");
  const [minePhone, setMinePhone] = useState("");
  const [mine, setMine] = useState(null);
  const [lastBookingData, setLastBookingData] = useState(null);

  useEffect(() => { activeBusinesses().then(p => { setPlaces(p); if (preselect) setMode("form"); }); }, []);
  const acc = (places || []).find(a => a.id === accId);
  const lang = acc ? getCountry(acc.country).l : "eg";
  const t = STR[lang];
  const services = acc ? (SERVICES[acc.type] || SERVICES.clinic) : [];
  useEffect(() => { onCtx && onCtx(acc ? { acc } : null); }, [accId, places]);

  // Pre-fill service from URL params when acc loads
  useEffect(() => {
    if (acc && paramService && !form.service) {
      setForm(f => ({ ...f, service: paramService }));
    }
  }, [acc]);

  async function book(paid) {
    setBusy(true);
    const r = refCode(); setLastRef(r);
    try {
      const staffVal = encodeStaffWithPrice(null, form.amount);
      await addBooking({ business_id: accId, ref: r, client_name: form.name, client_phone: form.phone, service: form.service, staff: staffVal, date: form.date, time: form.time, from_client: true, paid });
      
      setLastBookingData({
        client_name: form.name,
        client_phone: form.phone,
        service: form.service,
        date: form.date,
        time: form.time,
        ref: r,
        paid,
        staff: staffVal,
      });

      // إرسال فاتورة للعميل
      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "invoice",
            ref: r,
            client_name: form.name,
            client_phone: form.phone,
            client_email: form.email || null,
            business_name: acc.business,
            business_address: acc.address,
            service: form.service,
            date: form.date,
            time: form.time,
            amount: form.amount || null,
            currency: getCountry(acc.country).cur,
            payment_method: paid ? "دفع أونلاين" : "كاش عند الوصول",
          }),
        });
      } catch (e) {
        console.log("Invoice email failed silently");
      }

      setMode("done");
    } catch (e) { alert(e.message); }
    setBusy(false);
  }
  async function findMine() {
    if (!minePhone.trim()) return;
    setBusy(true);
    setMine(await bookingsByPhone(minePhone));
    setBusy(false);
  }

  if (places === null) return <Center dir="rtl"><Loader2 className="animate-spin text-indigo-600" size={28} /></Center>;
  if (places.length === 0) return <Center dir="rtl"><div className="text-center text-slate-500"><p className="mb-3">{STR.eg.noPlaces}</p><button onClick={onBack} className="text-indigo-600 text-sm">{STR.eg.back}</button></div></Center>;

  const waText = acc ? encodeURIComponent(`✅ ${t.bookDone}\n${acc.business}\n${form.service}\n${form.date} ${form.time}\n${t.ref}: ${lastRef}\n📍 ${acc.address}`) : "";

  if (mode === "mine") {
    const tt = STR.eg;
    return (
      <Center dir="rtl">
        <div className="w-full max-w-sm">
          <h2 className="text-lg font-bold text-slate-800 text-center mb-4 flex items-center justify-center gap-2"><Ticket size={18} /> {tt.myBookings}</h2>
          <div className="bg-white rounded-2xl p-4 shadow-sm border mb-3 flex gap-2">
            <input value={minePhone} onChange={e => setMinePhone(e.target.value)} placeholder={tt.enterPhone} className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" dir="ltr" />
            <button onClick={findMine} disabled={busy} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm">{busy ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}</button>
          </div>
          {mine !== null && (mine.length === 0 ? <p className="text-center text-sm text-slate-400 py-4">{tt.noneFound}</p> : (
            <div className="space-y-2">
              {mine.map(b => (
                <div key={b.id} className="bg-white rounded-xl p-3 shadow-sm border">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-slate-800">{b.biz_name}</span>
                    <span className="text-xs font-mono text-slate-400" dir="ltr">{b.ref}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{b.service} · {b.date} {String(b.time).slice(0, 5)} {b.paid ? "· 💳" : ""}</p>
                  <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5"><MapPin size={11} /> {b.biz_address}</p>
                </div>
              ))}
            </div>
          ))}
          <button onClick={() => { setMode("browse"); setMine(null); }} className="w-full mt-4 text-sm text-slate-500">{tt.back}</button>
        </div>
      </Center>
    );
  }

  // Change 2: Beautiful Invoice Screen
  if (mode === "done") {
    const bookingForInvoice = lastBookingData || { client_name: form.name, client_phone: form.phone, service: form.service, date: form.date, time: form.time, ref: lastRef, paid: false, staff: encodeStaffWithPrice(null, form.amount) };
    const priceVal = parsePrice(bookingForInvoice.staff) || form.amount;
    
    return (
      <>
        <style>{`
          @media print {
            body * { visibility: hidden; }
            #invoice, #invoice * { visibility: visible; }
            #invoice { position: absolute; top: 0; left: 0; width: 100%; }
          }
        `}</style>
        <Center dir={t.dir}>
          <div id="invoice" className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 border border-slate-200">
            <div className="text-center border-b-2 border-slate-200 pb-4 mb-4">
              <p className="text-2xl font-bold text-slate-800">🧾 فاتورة حجز</p>
              <p className="text-indigo-600 font-semibold text-sm mt-1">احجزلي</p>
            </div>
            <div className="space-y-2.5 text-sm text-slate-700 border-b border-slate-100 pb-3 mb-3">
              <div className="flex justify-between"><span>👤 الاسم:</span><span className="font-semibold">{form.name}</span></div>
              <div className="flex justify-between"><span>📱 الموبايل:</span><span className="font-semibold" dir="ltr">{form.phone}</span></div>
            </div>
            <div className="space-y-2.5 text-sm text-slate-700 border-b border-slate-100 pb-3 mb-3">
              <div className="flex justify-between"><span>🏥 المكان:</span><span className="font-semibold">{acc?.business}</span></div>
              <div className="flex justify-between"><span>📍 العنوان:</span><span className="font-semibold text-xs">{acc?.address}</span></div>
              <div className="flex justify-between"><span>✂️ الخدمة:</span><span className="font-semibold">{form.service}</span></div>
              <div className="flex justify-between"><span>📅 التاريخ:</span><span className="font-semibold">{form.date}</span></div>
              <div className="flex justify-between"><span>⏰ الوقت:</span><span className="font-semibold">{form.time}</span></div>
            </div>
            <div className="space-y-2.5 text-sm text-slate-700 border-b border-slate-100 pb-3 mb-3">
              {priceVal && (
                <div className="flex justify-between"><span>💰 المبلغ:</span><span className="font-bold text-green-700">{priceVal} {getCountry(acc?.country || "EG").cur}</span></div>
              )}
              <div className="flex justify-between"><span>💳 الدفع:</span><span className="font-semibold">{bookingForInvoice.paid ? "تحويل / كارت" : "نقداً عند الوصول"}</span></div>
              <div className="flex justify-between"><span>🔖 كود الحجز:</span><span className="font-bold text-indigo-600 font-mono" dir="ltr">{lastRef}</span></div>
            </div>
            <div className="text-center mb-4">
              <p className="text-green-600 font-bold text-lg">✅ تم التأكيد</p>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => window.print()} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 transition">🖨️ طباعة</button>
              <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noreferrer" className="block w-full bg-green-600 text-white py-2.5 rounded-xl text-sm font-medium text-center">
                <span className="flex items-center justify-center gap-2"><Share2 size={16} /> {t.shareWa}</span>
              </a>
              <button onClick={() => { setMode("browse"); setAccId(""); setForm({ name: "", phone: "", service: "", date: today(), time: "", amount: "" }); setLastBookingData(null); }} className="text-indigo-600 text-sm">{t.another}</button>
            </div>
          </div>
        </Center>
      </>
    );
  }

  if (mode === "pay" && acc) {
    return (
      <Center dir={t.dir}>
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl p-5 shadow-sm border">
            <h2 className="font-bold text-slate-800 mb-1 flex items-center gap-2"><CreditCard size={18} /> {t.howPay}</h2>
            <p className="text-xs text-slate-400 mb-4">{acc.business} · {form.service} · {form.date} {form.time}</p>
            {form.amount && <p className="text-sm font-bold text-green-700 mb-3">💰 المبلغ: {form.amount} {getCountry(acc.country).cur}</p>}
            <div className="space-y-2">
              {acc.cash_ok !== false && <button onClick={() => book(false)} disabled={busy} className="w-full bg-white border border-slate-200 text-slate-700 py-2.5 rounded-xl text-sm font-medium">{t.payVenue}</button>}
              {(acc.wallet || acc.bank) && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-sm">
                  <p className="font-medium text-xs text-emerald-700 mb-1">💸 {t.payTo}</p>
                  {acc.wallet && <p dir="ltr" className="font-mono text-emerald-800">📱 {acc.wallet}</p>}
                  {acc.bank && <p dir="ltr" className="font-mono text-emerald-800">🏦 {acc.bank}</p>}
                  <button onClick={() => book(true)} disabled={busy} className="w-full mt-2 bg-emerald-600 text-white py-2 rounded-lg text-xs font-medium">{t.transferred}</button>
                </div>
              )}
            </div>
          </div>
          <button onClick={() => setMode("form")} className="w-full mt-4 text-sm text-slate-500">{t.back}</button>
        </div>
      </Center>
    );
  }

  if (mode === "form" && acc) {
    return (
      <Center dir={t.dir}>
        <div className="w-full max-w-sm">
          <div className="bg-indigo-50 rounded-2xl p-4 mb-4">
            <p className="font-bold text-indigo-900">{acc.business} <span className="text-xs font-normal">({t.types[acc.type] || acc.type})</span></p>
            <p className="text-xs text-indigo-600 flex items-center gap-1 mt-1"><MapPin size={12} /> {acc.address}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {services.map(s => <span key={s} className="text-[10px] bg-white text-indigo-600 px-2 py-0.5 rounded-full">{s}</span>)}
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm border space-y-3">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t.clientName} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder={t.clientPhone} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" dir="ltr" />
            <select value={form.service} onChange={e => setForm({ ...form, service: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">{t.chooseService}</option>{services.map(s => <option key={s}>{s}</option>)}
            </select>
            {/* Show amount as read-only if provided via URL */}
            {form.amount && (
              <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-sm text-green-700 font-bold">
                💰 المبلغ: {form.amount} {getCountry(acc.country).cur}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={form.date} min={today()} onChange={e => setForm({ ...form, date: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button onClick={() => { if (form.name && form.phone && form.service && form.time) setMode("pay"); }} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-medium">{t.confirmBook}</button>
          </div>
          <button onClick={() => { setMode("browse"); setAccId(""); }} className="w-full mt-4 text-sm text-slate-500">{t.back}</button>
        </div>
      </Center>
    );
  }

  return (
    <Center dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-4">
          <div className="bg-indigo-600 p-3 rounded-2xl inline-flex mb-2"><Calendar className="text-white" size={24} /></div>
          <h1 className="text-lg font-bold text-slate-800">{STR.eg.bookYourSlot}</h1>
        </div>
        <button onClick={() => setMode("mine")} className="w-full bg-white border border-indigo-200 text-indigo-600 py-2 rounded-xl text-sm font-medium mb-4 flex items-center justify-center gap-2"><Ticket size={15} /> {STR.eg.myBookings}</button>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pb-2">
          {places.map(a => {
            const ac = getCountry(a.country);
            const al = STR[ac.l];
            const srv = SERVICES[a.type] || [];
            return (
              <button key={a.id} onClick={() => { setAccId(a.id); setMode("form"); }} className="w-full text-right bg-white rounded-2xl p-4 shadow-sm border hover:border-indigo-300">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">{ac.f} {a.business}</span>
                  <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{al.types[a.type] || a.type}</span>
                </div>
                <p className="text-xs text-slate-500 flex items-center gap-1 mt-1"><MapPin size={11} /> {a.address}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {srv.slice(0, 4).map(s => <span key={s} className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{s}</span>)}
                </div>
              </button>
            );
          })}
        </div>
        <button onClick={onBack} className="w-full mt-4 text-sm text-slate-500">{STR.eg.back}</button>
      </div>
    </Center>
  );
}

function Center({ children, dir = "rtl" }) {
  return <div dir={dir} className="min-h-screen bg-slate-50 flex items-center justify-center p-4" style={{ fontFamily: "system-ui, sans-serif" }}>{children}</div>;
}
function StatCard({ icon, label, value, color }) {
  return (
    <div className="bg-white rounded-2xl p-3 shadow-sm border">
      <div className={`inline-flex p-2 rounded-lg ${color} mb-2`}>{icon}</div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}