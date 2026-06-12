import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const envContent = fs.readFileSync(".env", "utf8");
const env = {};
envContent.split("\n").forEach(line => {
  const parts = line.split("=");
  if (parts.length >= 2) {
    env[parts[0].trim()] = parts.slice(1).join("=").trim();
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

async function main() {
  console.log("Testing create_booking...");
  try {
    const res = await create_booking({
      business_id: "b30567e4-e5d7-4f77-b32b-0ad072ba5fdf",
      client_name: "عميل تجريبي من البوت",
      client_phone: "01202188684",
      service: "كشف",
      date: "2026-06-13",
      time: "11:00:00"
    });
    console.log("create_booking succeeded! Ref:", res.ref);
  } catch (e) {
    console.error("create_booking failed:", e);
  }
}

main();
