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

    if (!["admin", "editor"].includes(userRow?.role ?? "")) {
      return json({ error: "Ikkje tilgang" }, 403);
    }

    const { to_email, to_name, subject, body, html, reply_to, attachments } = await req.json();

    if (!to_email || !subject || !body) {
      return json({ error: "Manglande felt: to_email, subject, body" }, 400);
    }

    // Grunnleggande input-avgrensingar — hindrar misbruk av ein autorisert konto
    // (t.d. spam-utsending eller uforholdsmessig store nyttelaster) og openbre feilinntastingar.
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(to_email)) {
      return json({ error: "Ugyldig e-postadresse" }, 400);
    }
    if (subject.length > 300) {
      return json({ error: "Emnefeltet er for langt (maks 300 teikn)" }, 400);
    }
    if (body.length > 50000 || (typeof html === "string" && html.length > 100000)) {
      return json({ error: "Meldinga er for lang" }, 400);
    }
    if (Array.isArray(attachments)) {
      if (attachments.length > 5) {
        return json({ error: "For mange vedlegg (maks 5)" }, 400);
      }
      const totalBase64Len = attachments.reduce(
        (sum: number, a: { content?: string }) => sum + (a?.content?.length ?? 0),
        0,
      );
      // Base64 er ~4/3 av rå byte-storleik — 15 000 000 teikn er grovt ~11 MB totalt.
      if (totalBase64Len > 15_000_000) {
        return json({ error: "Vedlegga er for store til saman (maks ca. 11 MB)" }, 400);
      }
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ error: "RESEND_API_KEY ikkje satt i secrets" }, 500);

    const fromName  = Deno.env.get("RESEND_FROM_NAME")  || "Vibeverk";
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@vibeverk.no";

    // Genererer vår EIGEN RFC5322 Message-ID og sender han med som ein eigen
    // header på sjølve sendekallet, i staden for å stole på eit oppfølgings-
    // kall til Resend sin GET /emails/{id} for å hente ein Message-ID i
    // ettertid (sjå lenger ned) -- stadfesta empirisk 2026-07-19 at DETTE
    // oppfølgingskallet ALDRI har gjeve eit brukbart resultat i produksjon,
    // over tre veker (kvar einaste email_sent-rad hadde data.resendMessageId
    // = NULL). Konsekvens: process_inbound_email() sin tråd-matching
    // (In-Reply-To/References mot nettopp dette feltet, sjå
    // supabase/migrations/20260717120000_inbound_email.sql) har ALDRI kunna
    // lykkast for noko svar -- kvart einaste ekte, autentisert kundesvar har
    // difor stille hamna i "ukjend avsendar"-greina og vorte feilaktig merkt
    // "Ikkje verifisert" i CRM-et. Å generere Message-ID-en sjølv, FØR
    // sending, fjernar heile denne race/timing-avhengnaden.
    const ourMessageId = `<${crypto.randomUUID()}@vibeverk.no>`;

    const payload: Record<string, unknown> = {
      from:    `${fromName} <${fromEmail}>`,
      to:      to_name ? [`${to_name} <${to_email}>`] : [to_email],
      subject,
      text:    body,
      headers: { "Message-ID": ourMessageId },
    };
    if (html) payload.html = html;
    if (Array.isArray(attachments) && attachments.length) payload.attachments = attachments;
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

    // Reint diagnostisk oppfølgingskall no -- IKKJE lenger load-bearing for
    // returverdien (den er alltid ourMessageId over). Behalde for å
    // stadfesta/avkrefte om Resend faktisk bevarer ein sjølvvald
    // Message-ID-header uendra (kan ikkje avgjerast utan ein ekte sending) --
    // sjå Supabase-funksjonsloggane for "[send-reply] verify-messageid" etter
    // neste ekte sending. Kort retry sidan Resend sitt system truleg treng
    // litt tid før GET /emails/{id} har full metadata klar. Vert `await`-a
    // (ikkje eit uavhengig bakgrunnsløfte) sidan Deno Edge Functions ikkje
    // garanterer at usikra bakgrunnsarbeid held fram å køyre etter at eit
    // svar alt er sendt tilbake til klienten -- same synkrone mønster som
    // det opphavlege, eittgongs oppfølgingskallet hadde.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await new Promise((r) => setTimeout(r, attempt * 300));
      try {
        const mResp = await fetch("https://api.resend.com/emails/" + resendData.id, {
          headers: { "Authorization": `Bearer ${apiKey}` },
        });
        const mData = await mResp.json().catch(() => null);
        console.error(`[send-reply] verify-messageid forsøk ${attempt}:`, mResp.status, JSON.stringify(mData));
        const gotMessageId =
          mData?.message_id ||
          mData?.headers?.["Message-ID"] ||
          mData?.headers?.["message-id"] ||
          null;
        if (gotMessageId) {
          if (gotMessageId !== ourMessageId) {
            console.warn(`[send-reply] Resend sin ekte Message-ID (${gotMessageId}) skil seg frå vår eigen (${ourMessageId}) -- Resend bevarer IKKJE ein sjølvvald header uendra.`);
          } else {
            console.error("[send-reply] Stadfesta: Resend bevarte vår sjølvvalde Message-ID uendra.");
          }
          break;
        }
      } catch (e) {
        console.error(`[send-reply] verify-messageid forsøk ${attempt} feila:`, String(e));
      }
    }

    return json({ success: true, id: resendData.id, message_id: ourMessageId });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
