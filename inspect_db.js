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

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function checkPrice() {
  const { data, error } = await supabase.from("bookings").insert({
    business_id: "b30567e4-e5d7-4f77-b32b-0ad072ba5fdf",
    ref: "TEST-REF",
    client_name: "test",
    client_phone: "0100",
    service: "test",
    date: "2026-06-13",
    time: "12:00:00",
    price: 1000 // Let's check if this causes an error
  }).select();

  console.log("Insert with price result:", data, "Error:", error);
}

checkPrice();
