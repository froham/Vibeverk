// send-reply — sender e-postsvar via Resend på vegne av admin.
// Krev: RESEND_API_KEY i Supabase secrets.
// Valfritt: RESEND_FROM_NAME, RESEND_FROM_EMAIL (standard: noreply@vibeverk.no)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Ikkje autorisert" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json({ error: "Ikkje autorisert" }, 401);

    const { data: userRow } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!["owner", "admin", "editor"].includes(userRow?.role ?? "")) {
      return json({ error: "Ikkje tilgang" }, 403);
    }

    const { to_email, to_name, subject, body, reply_to } = await req.json();

    if (!to_email || !subject || !body) {
      return json({ error: "Manglande felt: to_email, subject, body" }, 400);
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ error: "RESEND_API_KEY ikkje satt i secrets" }, 500);

    const fromName  = Deno.env.get("RESEND_FROM_NAME")  || "Vibeverk";
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@vibeverk.no";

    const payload: Record<string, unknown> = {
      from:    `${fromName} <${fromEmail}>`,
      to:      to_name ? [`${to_name} <${to_email}>`] : [to_email],
      subject,
      text:    body,
    };
    payload.reply_to = reply_to || Deno.env.get("RESEND_REPLY_TO") || "hei@vibeverk.no";

    const resendResp = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    const resendData = await resendResp.json();
    if (!resendResp.ok) {
      return json({ error: resendData.message || "Resend returnerte feil" }, 502);
    }

    return json({ success: true, id: resendData.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
