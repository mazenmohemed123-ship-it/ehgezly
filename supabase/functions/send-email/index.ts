import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { 
      type, 
      ref, 
      client_name, 
      client_phone, 
      client_email, 
      business_name, 
      business_address, 
      service, 
      date, 
      time, 
      currency, 
      payment_method, 
      country, 
      method 
    } = await req.json()

    let subject = ''
    let html = ''
    let toEmail = ''

    if (type === 'admin_notify') {
      toEmail = 'admin@ehgezly.com'
      subject = `طلب تفعيل اشتراك جديد: ${business_name}`
      html = `
        <div style="font-family: sans-serif; direction: rtl; text-align: right; padding: 20px;">
          <h2>طلب تفعيل اشتراك جديد 🚀</h2>
          <p>اسم المكان: <strong>${business_name}</strong></p>
          <p>الدولة: <strong>${country}</strong></p>
          <p>طريقة الدفع: <strong>${method}</strong></p>
          <p>يرجى مراجعة لوحة تحكم الإدارة وتفعيل الحساب.</p>
        </div>
      `
    } else if (type === 'invoice') {
      // If client email isn't provided, use a default fallback or skip
      toEmail = client_email || 'client@ehgezly.com'
      subject = `تأكيد حجزك في ${business_name} - ${ref}`
      html = `
        <div style="font-family: sans-serif; direction: rtl; text-align: right; padding: 20px; border: 1px solid #eee; border-radius: 12px; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #4f46e5; text-align: center; border-bottom: 2px solid #eee; padding-bottom: 10px;">فاتورة حجز — احجزلي</h2>
          <p>مرحباً <strong>${client_name}</strong>، تم تأكيد حجزك بنجاح.</p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <tr>
              <td style="padding: 8px 0; color: #666;">كود الحجز:</td>
              <td style="padding: 8px 0; font-weight: bold; font-family: monospace;">${ref}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">المكان:</td>
              <td style="padding: 8px 0; font-weight: bold;">${business_name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">العنوان:</td>
              <td style="padding: 8px 0;">${business_address}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">الخدمة:</td>
              <td style="padding: 8px 0; font-weight: bold;">${service}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">التاريخ والوقت:</td>
              <td style="padding: 8px 0;">${date} @ ${time}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">طريقة الدفع:</td>
              <td style="padding: 8px 0;">${payment_method}</td>
            </tr>
          </table>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="text-align: center; font-size: 12px; color: #999;">تم التوليد بواسطة احجزلي — ehgezly.com</p>
        </div>
      `
    }

    if (!toEmail || toEmail === 'client@ehgezly.com' && !client_email) {
      console.log('Skipping email send: client email not provided');
      return new Response(JSON.stringify({ message: 'Skipped send: no email address' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'احجزلي <onboarding@resend.dev>',
        to: toEmail,
        subject: subject,
        html: html
      })
    })

    const resData = await res.json()

    return new Response(JSON.stringify(resData), {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})