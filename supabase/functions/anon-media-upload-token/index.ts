// supabase/functions/anon-media-upload-token/index.ts
// Gjev eit signert opplastings-token til den offentlege "media"-bucket-en
// (Tilbod-skjemaet sine vedlegg, module-quote.js) -- men BERRE dersom den
// kallande IP-adressa ikkje alt har nådd dagens kvote. Sjå
// supabase/migrations/20260719124203_anon_media_upload_quota.sql for
// bakgrunn/grunngjeving og bump_and_check_anon_upload_quota()-funksjonen
// dette kallar.
//
// Krev IKKJE ein innlogga brukar -- kalt av anonyme besøkjande, same som
// insert_anon_lead()-RPC-en. Anon-nøkkelen (som supabase-js sender
// automatisk) tilfredsstiller Supabase sin standard verify_jwt-sjekk åleine.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const DAILY_LIMIT = 20;
const MAX_FILENAME_LEN = 200;

async function hashIp(ip: string, pepper: string): Promise<string> {
  const data = new TextEncoder().encode(pepper + ":" + ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Berre POST er støtta" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Ein hemmeleg, tilfeldig streng -- berre brukt til å salte IP-hashen slik
  // at rå IP-adresser aldri lagrast i databasen (dataminimerings-omsyn).
  // Må setjast via `npx supabase secrets set` før denne funksjonen fungerer
  // reelt -- fell tilbake til eit fast (svakare, men framleis funksjonelt)
  // ord lokalt/i test, sidan fråvær av denne secreten ikkje skal blokkere
  // heile opplastingsfunksjonen.
  const pepper = Deno.env.get("ANON_UPLOAD_QUOTA_PEPPER") || "vibeverk-dev-pepper";

  const body = await req.json().catch(() => ({}));
  const filename = typeof body.filename === "string" ? body.filename : "";
  const contentType = typeof body.contentType === "string" ? body.contentType : "application/octet-stream";
  if (!filename || filename.length > MAX_FILENAME_LEN) {
    return json({ error: "Ugyldig filnamn" }, 400);
  }

  // Supabase sitt edge-lag set x-forwarded-for med den faktiske besøkjande-
  // IP-en fyrst i lista. Ikkje empirisk stadfesta mot ein ekte produksjons-
  // request enno (same disiplin som DMARC-arbeidet i inbound-email) -- fell
  // trygt tilbake til éin delt kvote-bøtte ("ukjend") dersom fråverande,
  // heller enn å feile heile opplastinga.
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0].trim() || "ukjend";
  const bucketKey = await hashIp(ip, pepper);

  const adminSb = createClient(supabaseUrl, serviceKey);

  const { data: underQuota, error: quotaErr } = await adminSb.rpc(
    "bump_and_check_anon_upload_quota",
    { p_key: bucketKey, p_limit: DAILY_LIMIT }
  );
  if (quotaErr) return json({ error: "Kunne ikke sjekke opplastingskvote" }, 500);
  if (!underQuota) {
    return json({ error: "For mange opplastinger i dag. Prøv igjen i morgen, eller send henvendelsen uten vedlegg." }, 429);
  }

  const ext = (filename.split(".").pop() || "bin").toLowerCase();
  const path = "files/" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) + "." + ext;

  const { data, error } = await adminSb.storage.from("media").createSignedUploadUrl(path);
  if (error) return json({ error: "Kunne ikke forberede opplasting" }, 500);

  return json({ path: data.path, token: data.token, contentType });
});
