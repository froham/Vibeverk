// supabase-control/supabase/functions/broker/index.ts
// Phase 8 of the SaaS-scaling plan: real broker actions, extending the
// Phase 7 broker-ping mechanism-proof (see docs/decisions/ADR-0008 and its
// forthcoming Phase 8 addendum/ADR). Same two-client pattern as broker-ping
// and supabase/functions/manage-user: an anon-key client validates the
// caller is a real, active control-plane operator; a service-role client
// then performs the privileged action, crossing into the TARGET tenant's
// own data-plane project using a Vault-decrypted key that is never
// returned to the caller.
//
// Every action writes an entry to broker_audit_log (via the control
// plane's own service-role client, which bypasses that table's RLS) before
// returning — success or failure, but NEVER the value of any secret.
//
// Deliberately out of scope for this action set: inviting/removing a
// data-plane user on an operator's behalf. That overlaps the still-open
// "support access" question (see ADR-0008 and the Phase 8 design notes),
// which needs Privacy/Compliance input before being decided — not
// pre-empted here.
//
// Security Auditor pre-merge review (2026-07-09) of the round-2 hardening
// in the sibling tenant-admin function found finding M2 applies here too:
// an inactive-operator rejection was never audit-logged. Body parsing moved
// earlier so the rejected action/tenant_id can still be logged.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser, XMLSerializer } from "https://esm.sh/@xmldom/xmldom@0.8.10?target=deno";
// INCIDENT 2026-08-13: imagescript@1.3.0 var tidlegare eit statisk
// top-level-import. deno.land sitt CDN byrja då å svare med eit brotli-
// dekomprimeringsfeil for denne pakken sin WASM-ressurs -- sidan eit
// statisk import evaluerast ved MODULLASTING, tok dette ned HEILE
// broker-funksjonen (alle handlingar, ikkje berre biletopplasting),
// stadfesta live via net-loggane (WORKER_ERROR/UncaughtException på kvar
// einaste kalling, inkludert reine OPTIONS-preflightar). Retta ved å gjere
// importen DYNAMISK og lat -- berre henta INNI compressRasterImage() (den
// einaste brukaren), med eit try/catch som fell tilbake til den alt
// eksisterande "kunne ikkje komprimerast"-feilmeldinga (400) i staden for å
// krasje heile funksjonen dersom CDN-et framleis er nede. Ingen annan
// handling i denne fila skal nokon gong vere avhengig av at dette
// biblioteket faktisk lastar.

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Only these two store keys may ever be read/written through this broker —
// an explicit allowlist, not "any key the caller names."
// "analytics" added 2026-07-09 (Console tenant-picker follow-up): previously
// read/written via App.store.get/set("analytics", ...) on the client, which
// never actually reached Supabase for any tenant (App.store's write-through
// is gated on a login state Console never establishes) -- routed through the
// same broker path as superconfig now. reset_config below also clears it,
// matching the "reset everything" intent of that button.
// "custom-pages" added 2026-08-11 (Sidebygger, Fase 1): sidebygger-sider
// (module-page-builder.js) sitt lagringsskjema. Console er einaste skrivar
// i Fase 1 (ingen kundeflyt finst enno) -- kunden sin eigen tenant-økt kan
// aldri tilfredsstille store sin can_edit_content()-RLS via Console sin
// anon-nøkkel tenantPublicClient() (ho har med vilje persistSession:false),
// difor må skriving gå via denne service-role-broker-vegen, same som
// superconfig alt gjer.
const ALLOWED_CONFIG_KEYS = ["superconfig", "superconfig-private", "analytics", "custom-pages"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── SVG-sanering (custom design-modul, logo-opplasting) ─────────────────────
// Allowlist-basert, ikkje blokklist/regex-strip: berre desse elementa/
// attributta får bli med, alt anna vert fjerna. <script>/<foreignObject>/
// <style>/SMIL-animasjonselement (<animate> m.fl.) er difor allereie utelatt
// berre ved å IKKJE stå i lista -- ikkje avhengig av å eksplisitt "fange" dei.
// href/xlink:href er avgrensa til interne fragment-referansar (#...) eller
// data:-URI-ar med biletmime (base64), aldri eksterne URL-ar -- ein logo skal
// aldri kunne ringe heim. on*-attributt og javascript:-verdiar vert stripa
// som eit ekstra forsvarslag sjølv om dei uansett aldri ville stått i
// allowlista. DOCTYPE vert fjerna FØR parsing (XXE/entitetsutviding-vern,
// uavhengig av om parsaren sjølv ville løyst eksterne entitetar).
const SVG_ALLOWED_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask",
  "symbol", "use", "title", "desc", "text", "tspan", "image",
]);
const SVG_ALLOWED_ATTRS = new Set([
  "id", "class", "xmlns", "xmlns:xlink", "version", "viewbox", "width", "height",
  "preserveaspectratio", "transform", "d", "x", "y", "x1", "y1", "x2", "y2",
  "cx", "cy", "r", "rx", "ry", "points", "fill", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity",
  "fill-opacity", "stroke-opacity", "offset", "stop-color", "stop-opacity",
  "gradientunits", "gradienttransform", "fx", "fy", "clip-path", "clip-rule",
  "fill-rule", "font-family", "font-size", "font-weight", "text-anchor",
]);
function isSafeHrefValue(v: string): boolean {
  if (v.indexOf("#") === 0) return true;
  return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(v);
}
function sanitizeSvgAttrs(el: any) {
  if (!el.attributes) return;
  for (let a = el.attributes.length - 1; a >= 0; a--) {
    const attr = el.attributes[a];
    const name = attr.name.toLowerCase();
    const value = attr.value || "";
    if (name.indexOf("on") === 0) { el.removeAttribute(attr.name); continue; }
    if (/javascript:/i.test(value)) { el.removeAttribute(attr.name); continue; }
    if (name === "href" || name === "xlink:href") {
      if (!isSafeHrefValue(value)) el.removeAttribute(attr.name);
      continue;
    }
    if (name === "xmlns" || name === "xmlns:xlink") continue; // alltid lov på rota
    if (!SVG_ALLOWED_ATTRS.has(name)) el.removeAttribute(attr.name);
  }
}
function sanitizeSvgTree(node: any) {
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i];
    if (child.nodeType === 1) { // ELEMENT_NODE
      const tag = (child.tagName || "").toLowerCase();
      if (!SVG_ALLOWED_TAGS.has(tag)) { node.removeChild(child); continue; }
      sanitizeSvgAttrs(child);
      sanitizeSvgTree(child);
    } else if (child.nodeType === 7 || child.nodeType === 8) {
      // PROCESSING_INSTRUCTION_NODE / COMMENT_NODE -- ikkje naudsynt, fjern.
      node.removeChild(child);
    }
  }
}
// Security Auditor pre-merge review (2026-07-16): sanitizeSvgTree() was
// previously only ever called on the root <svg> ELEMENT, never on the
// Document itself -- a sibling processing instruction on the DOCUMENT (e.g.
// a leading <?xml-stylesheet href="https://evil/mal.xsl"?> before <svg>)
// survived serialization untouched. Now strips every Document-level child
// that isn't the root <svg> element (PIs, comments, a stray second root)
// BEFORE sanitizing the root's own subtree.
function sanitizeSvgDocument(doc: any, root: any) {
  for (let i = doc.childNodes.length - 1; i >= 0; i--) {
    const child = doc.childNodes[i];
    if (child !== root) doc.removeChild(child);
  }
}
function sanitizeSvg(input: string): string | null {
  const noDoctype = input.replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?[^>]*>/gi, "");
  // Defence-in-depth: reject outright if anything DOCTYPE/ENTITY-shaped
  // survived the strip above -- the regex is a best-effort match against
  // DTD grammar that isn't itself regular, so don't rely on it alone.
  if (/<!doctype|<!entity/i.test(noDoctype)) return null;
  let doc: any;
  try {
    doc = new DOMParser().parseFromString(noDoctype, "image/svg+xml");
  } catch (_e) {
    return null;
  }
  const root = doc && doc.documentElement;
  if (!root || (root.tagName || "").toLowerCase() !== "svg") return null;
  sanitizeSvgDocument(doc, root);
  sanitizeSvgAttrs(root);
  sanitizeSvgTree(root);
  try {
    return new XMLSerializer().serializeToString(doc);
  } catch (_e) {
    return null;
  }
}
// Sniffar om ei fil FAKTISK ser ut som XML/SVG uavhengig av kva content_type
// klienten hevda -- Security Auditor pre-merge review (2026-07-16) fann at
// sanering berre var gata på det klient-oppgjevne content_type-feltet: SVG-
// byte sende med content_type: "image/png" gjekk rett forbi sanitizeSvg() og
// vart lagra usanert under ein misvisande Content-Type. No er "ser dette ut
// som XML?" den avgjerande sjekken for OM sanering/SVG-handsaming skjer, ikkje
// klienten sin påstand -- ein rein rasterfil vert aldri forveksla med SVG (dei
// startar aldri med "<"), og ei fil som ser ut som XML/SVG vert alltid sanert
// eller avvist, uansett kva content_type var oppgjeve som.
function looksLikeXml(bytes: Uint8Array): boolean {
  // Berre dei fyrste ~200 byte-a er relevante (BOM/whitespace/<?xml/<svg).
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 200));
  text = text.replace(/^﻿/, "").trimStart();
  return text.indexOf("<") === 0;
}

// Automatisk komprimering av for store PNG/JPEG-opplastingar (ønska av
// brukar under live-test 2026-07-17 av logo-opplastinga, som før berre
// avviste alt over 300KB). Prøver stigande grad av nedskalering, og for JPEG
// også søkkande kvalitet, frå det ORIGINALE (udekomprimerte) biletet kvar
// gong -- ikkje frå føregåande forsøk -- slik kvalitetstap ikkje hopar seg
// opp. Gjev opp og returnerer null viss ingen kombinasjon kjem under
// målstorleiken, då må brukaren sjølv redusere biletet.
//
// WebP er MEDVITE utelate: imagescript sin Image.decode() støttar berre
// PNG/JPEG/TIFF-dekoding (ikkje WebP), så ei WebP-fil kan ikkje opnast for
// å skalerast/komprimerast om att her -- WebP-opplastingar over 300KB vert
// difor avviste med det vanlege "for stor"-svaret same stad som før,
// uendra åtferd for den filtypen.

// Les berre BREIDD/HØGD frå PNG-/JPEG-headeren -- utan å dekode heile
// biletet -- slik at compressRasterImage() kan avvise mistenkjeleg store
// pikseldimensjonar FØR Image.decode() nokon gong køyrer. Security Auditor
// pre-merge review (2026-07-17), HIGH-funn: 6MB-taket på RÅ (koda) filstorleik
// avgrensar ikkje kor mange PIKSLAR ei PNG kan dekodast til -- ei vesle,
// låg-entropi PNG kan koda t.d. 30000×30000 piksel på under 300KB, som
// dekodert som RGBA er ~3.6GB minnebruk i éin einaste Edge Function-kalling.
// PNG: signatur (8 byte) + IHDR-lengd (4) + "IHDR" (4) + breidd (4) + høgd
// (4), begge big-endian uint32, alltid på faste byte-posisjonar. JPEG: skann
// segmenta etter ein SOF-marker (0xC0–0xCF, unnateke 0xC4/0xC8/0xCC som
// ikkje er SOF-marker) og les breidd/høgd derifrå.
function readImageDimensions(bytes: Uint8Array, ext: string): { width: number; height: number } | null {
  try {
    if (ext === "png") {
      if (bytes.length < 24) return null;
      if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
    }
    if (ext === "jpg") {
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
      let i = 2;
      while (i + 8 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        if (marker === 0xd9) break; // EOI
        const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
          return {
            height: (bytes[i + 5] << 8) | bytes[i + 6],
            width:  (bytes[i + 7] << 8) | bytes[i + 8],
          };
        }
        i += 2 + segLen;
      }
      return null;
    }
    return null;
  } catch (_e) {
    return null;
  }
}

// Skannar RGBA-bitmapet for minst éin piksel med alpha<255 -- brukt til å
// avgjere om ein PNG faktisk NYTTAR gjennomsikt (t.d. ein logo på
// transparent bakgrunn) før compressRasterImage() vurderer å JPEG-konvertere
// han vidare (JPEG har ingen alfakanal og ville øydelagt ekte gjennomsikt).
// deno-lint-ignore no-explicit-any -- Image-typen kjem no frå ein dynamisk
// import() (sjå compressRasterImage), difor ingen statisk type tilgjengeleg
// her utan å risikere same modullaste-krasjen som utløyste dette fiks.
function hasTransparency(img: any): boolean {
  const bmp = img.bitmap;
  for (let i = 3; i < bmp.length; i += 4) {
    if (bmp[i] < 255) return true;
  }
  return false;
}

interface CompressResult { bytes: Uint8Array; ext: string; }
interface CompressFailure { reason: string; }

async function compressRasterImage(bytes: Uint8Array, ext: string, targetBytes: number): Promise<CompressResult | CompressFailure> {
  // Brukarfunn 2026-09-03 (runde 2): alle fire ulike feilårsaker i denne
  // funksjonen returnerte tidlegare berre "null", og kallarane skreiv difor
  // ALLTID den same generiske "kunne ikkje komprimerast"-detaljen til
  // broker_audit_log -- umogleg å skilje "biletet er genuint for stort/
  // detaljert" frå "imagescript-importen frå deno.land feila" eller "decode
  // feila". Ein fyrste retting (utvida skaleringssteg) løyste IKKJE det
  // brukaren faktisk opplevde, nettopp fordi rotårsaka kunne vere ei av dei
  // andre tre. No returnerer funksjonen ei konkret årsak, logga direkte.
  const MAX_PIXELS = 25_000_000; // ~25 megapiksel -- rikeleg for ein logo
  const MAX_DIMENSION = 10000;
  const dims = readImageDimensions(bytes, ext);
  if (!dims || dims.width <= 0 || dims.height <= 0 ||
      dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION ||
      dims.width * dims.height > MAX_PIXELS) {
    return { reason: "pikseldimensjonane kunne ikkje lesast, eller er over grensa (maks " + MAX_DIMENSION + "px per side / " + (MAX_PIXELS / 1_000_000) + "MP)" };
  }
  // Dynamisk, lat import (INCIDENT 2026-08-13, sjå fila sin toppkommentar) --
  // om deno.land sitt CDN framleis er nede, fell dette trygt tilbake til ein
  // tydeleg feilmelding i staden for å krasje heile funksjonen slik eit
  // statisk import ville.
  // deno-lint-ignore no-explicit-any -- sjå notatet ved hasTransparency().
  let Image: any;
  // Brukarfunn 2026-09-03 (runde 5): jsdelivr sin GitHub-spegel (runde 4)
  // HJALP HELLER IKKJE -- brukar stadfesta same feil på nytt. Rotårsaka var
  // ikkje CDN-tilgjenge i seg sjølv (eit vanleg curl-kall mot begge URL-ane
  // synte HTTP 200 heile tida), men CONTENT-TYPE: GitHub-spegelen (og truleg
  // deno.land sitt eige `/x/`-register, gitt den vedvarande feilen der óg)
  // returnerer `text/plain`, som Deno sin modul-lastar KAN avvise som "Module
  // not found" sjølv om bytes faktisk er gyldig JS/TS -- stadfesta ved å
  // samanlikne curl-headers direkte. jsdelivr sin NPM-sti (`/npm/…/+esm`)
  // returnerer derimot `content-type: application/javascript` (stadfesta med
  // curl) OG bunter heile pakken (inkl. den transitive ImageScript.js-
  // importen) til éi fil -- fjernar samstundes den underliggjande klassen
  // feil frå 2026-08-13-incidenten (eit sundre fleirfils-modulgraf-oppslag),
  // ikkje berre denne eine symptomen. `imagescript` er stadfesta publisert
  // på npm (registry.npmjs.org, siste versjon 1.3.1, 1.3.0 finst). deno.land
  // sin eigen `/x/`-sti står att som siste utveg i tilfelle npm-stien sjølv
  // ein dag skulle feile.
  const imagescriptUrls = [
    "https://cdn.jsdelivr.net" + "/npm/imagescript@1.3.0/+esm",
    "https://deno.land" + "/x/imagescript@1.3.0/mod.ts",
  ];
  let lastImportError: unknown = null;
  for (let attempt = 0; attempt < imagescriptUrls.length; attempt++) {
    try {
      // URL-en bygd frå samanslåtte delar (ikkje éin bokstaveleg streng) --
      // Supabase sin bundlar prøver elles å STATISK løyse/pre-bundle kvar
      // einaste import()-kalling som har eit bokstaveleg strengargument,
      // sjølv om han er dynamisk, som gjorde den fyrste versjonen av denne
      // fiksen verdilaus (bundlinga feila likevel). Sundeling hindrar den
      // statiske analysen, og tvingar fram ei ekte, lat køyretidshenting.
      Image = (await import(imagescriptUrls[attempt]) as any).Image;
      lastImportError = null;
      break;
    } catch (e) {
      lastImportError = e;
      if (attempt < imagescriptUrls.length - 1) await new Promise(function (r) { setTimeout(r, 300); });
    }
  }
  if (lastImportError) {
    return { reason: "komprimeringsbiblioteket kunne ikkje lastast frå nokon av dei kjende kjeldene (mellombels driftsproblem hos ein ekstern leverandør) -- " + (lastImportError instanceof Error ? lastImportError.message : String(lastImportError)) };
  }
  let img;
  try {
    img = await Image.decode(bytes);
  } catch (e) {
    return { reason: "biletfila kunne ikkje dekodast -- " + (e instanceof Error ? e.message : String(e)) };
  }
  const isJpeg = ext === "jpg";
  // Brukarfunn 2026-08-12: PNG er tapsfritt og har ingen kvalitets-handtak i
  // imagescript (encode() utan argument = same lossless PNG att) -- ei
  // fotografisk PNG (skjermbilete, "lagre bilete som" frå nettlesaren) kunne
  // difor ofte IKKJE komprimerast nok med berre omskalering, sjølv på 40%
  // storleik, og feila med "kunne ikkje komprimerast nok" for heilt vanlege
  // 2-3MB bilete. Fell trygt tilbake til JPEG-komprimering for PNG-ar UTAN
  // FAKTISK BRUKT gjennomsikt (sjå hasTransparency over) -- PNG-ar som
  // faktisk treng alfakanalen (t.d. ein logo på transparent bakgrunn) held
  // fram med berre omskalering, akkurat som før, sidan JPEG ville øydelagt
  // gjennomsikta deira.
  const pngFallbackToJpeg = ext === "png" && !hasTransparency(img);
  const useJpegEncoding = isJpeg || pngFallbackToJpeg;
  const outExt = useJpegEncoding ? "jpg" : ext;
  const qualities = useJpegEncoding ? [85, 70, 55, 40, 25] : [null];
  // Brukarfunn 2026-09-03: ei PNG med FAKTISK (om enn kanskje utilsikta,
  // t.d. eit einskilt halvgjennomsiktig piksel frå eksport-verktøyet) alfa-
  // bruk held fram i tapsfri modus (sjå pngFallbackToJpeg over) og hadde
  // difor berre 40% som lågaste storleik å prøve -- ei fotografisk PNG med
  // ekte gjennomsikt kunne då feile med "kunne ikkje komprimerast nok"
  // sjølv på eit heilt vanleg foto, fordi tapsfri PNG-komprimering av eit
  // detaljert bilete ofte ikkje kjem under 600KB før på eit mykje mindre
  // steg enn 40%. Utvida med to mindre steg -- ufarleg for JPEG-vegen (som
  // så godt som alltid lykkast lenge før 40% uansett), gir reelt meir rom
  // for det tapsfrie sporet før funksjonen gjev opp.
  const scales = [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.15];
  for (const scale of scales) {
    const w = Math.max(64, Math.round(img.width * scale));
    const h = Math.max(64, Math.round(img.height * scale));
    const scaled = scale === 1 ? img : img.clone().resize(w, h);
    for (const q of qualities) {
      const encoded = useJpegEncoding ? await scaled.encodeJPEG(q as number) : await scaled.encode();
      if (encoded.length <= targetBytes) return { bytes: encoded, ext: outExt };
    }
  }
  return { reason: "nådde ikkje under " + Math.round(targetBytes / 1024) + "KB sjølv etter fleire forsøk på omskalering" + (useJpegEncoding ? "/kvalitetsreduksjon" : " (tapsfritt PNG-spor, ingen kvalitets-handtak tilgjengeleg)") };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Ikkje autorisert" }, 401);

  const controlUrl     = Deno.env.get("SUPABASE_URL")!;
  const controlAnonKey  = Deno.env.get("SUPABASE_ANON_KEY")!;
  const controlSrvKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerSb = createClient(controlUrl, controlAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerSb.auth.getUser();
  if (authErr || !user) return json({ error: "Ugyldig token" }, 401);

  // Parsed early (before the operator check below) so a rejected
  // authorization attempt can still be logged with the action/tenant_id it
  // was trying to reach (Security Auditor pre-merge finding M2) --
  // previously this happened after, so an unauthorized caller left zero
  // trace.
  const body = await req.json().catch(() => ({}));
  const { action, tenant_id } = body;

  const controlSrvSb = createClient(controlUrl, controlSrvKey);

  async function auditRejectEarly(detail: string) {
    const { error } = await controlSrvSb.from("broker_audit_log").insert({
      operator_id: user.id, tenant_id: tenant_id || null, action: action || "ukjend", result: "error", detail,
    });
    if (error) {
      console.error("[broker] KRITISK: audit-logg-skriving feila", { action, tenant_id, error: error.message });
    }
  }

  const { data: operator } = await callerSb
    .from("operators").select("status").eq("id", user.id).single();
  if (!operator || operator.status !== "active") {
    await auditRejectEarly("avvist: ikkje aktiv operatør");
    return json({ error: "Berre aktive operatørar" }, 403);
  }

  // Security Auditor follow-up round 2 (2026-07-09), finding 4: the two
  // mutating actions below (set_config, reset_config) now write the audit
  // row BEFORE performing the write and abort with 500 if that insert
  // itself fails — previously a failed audit insert was only console.error'd
  // and the write proceeded regardless, leaving zero forensic trail for a
  // real config change. Read-only actions (get_private_config,
  // get_tenant_status) keep the simpler post-hoc logger below, since there's
  // no mutation to guard in front of.
  async function auditStart(tenantId: string | null, action: string): Promise<string | null> {
    const { data, error } = await controlSrvSb
      .from("broker_audit_log")
      .insert({ operator_id: user.id, tenant_id: tenantId, action, result: "pending" })
      .select("id")
      .single();
    if (error) {
      console.error("[broker] KRITISK: audit-logg (pre-action) feila", { action, tenantId, error: error.message });
      return null;
    }
    return data.id as string;
  }
  async function auditFinish(auditId: string | null, result: "success" | "error", detail?: string) {
    if (!auditId) return;
    const { error } = await controlSrvSb
      .from("broker_audit_log")
      .update({ result, detail: detail || null })
      .eq("id", auditId);
    if (error) {
      console.error("[broker] KRITISK: audit-logg (post-action) feila", { auditId, result, error: error.message });
    }
  }

  async function audit(tenantId: string | null, action: string, result: "success" | "error", detail?: string) {
    const { error: auditErr } = await controlSrvSb.from("broker_audit_log").insert({
      operator_id: user.id,
      tenant_id: tenantId,
      action,
      result,
      detail: detail || null,
    });
    // The audit log is the compensating control for this broker's
    // concentrated blast radius (see ADR-0009) — a silently-failing insert
    // here would mean actions keep succeeding with zero forensic trail.
    // Never let it throw (that would break the actual action), but always
    // surface the failure to function logs. Used only for read-only actions
    // now (get_private_config, get_tenant_status) and the pre-tenant-lookup
    // rejection paths below — mutating actions use auditStart/auditFinish.
    if (auditErr) {
      console.error("[broker] KRITISK: audit-logg-skriving feila", { action, tenantId, auditErr: auditErr.message });
    }
  }

  // action/tenant_id already destructured above, before the operator check,
  // for the auth-failure audit path.
  if (!tenant_id) return json({ error: "tenant_id er påkrevd" }, 400);

  const { data: tenant, error: tenantErr } = await controlSrvSb
    .from("tenants")
    .select("id, slug, data_plane_url, data_plane_storage_key")
    .eq("id", tenant_id)
    .single();
  if (tenantErr || !tenant) {
    await audit(tenant_id, action, "error", "ukjend tenant");
    return json({ error: "Ukjend tenant" }, 404);
  }

  const { data: tenantServiceKey, error: keyErr } = await controlSrvSb
    .rpc("get_tenant_service_role_key", { p_tenant_id: tenant_id });
  if (keyErr || !tenantServiceKey) {
    await audit(tenant.id, action, "error", "fann ikkje service_role-nøkkel");
    return json({ error: "Fann ikkje service_role-nøkkel" }, 500);
  }

  const tenantSrvSb = createClient(tenant.data_plane_url, tenantServiceKey);
  const storageKey = tenant.data_plane_storage_key;

  // ── get_private_config ──────────────────────────────────────────────────
  // superconfig-private is never anon-readable (RLS requires
  // is_platform_operator() for both read and write) — only reachable via
  // this broker now.
  if (action === "get_private_config") {
    const { data, error } = await tenantSrvSb
      .from("store").select("value")
      .eq("tenant_id", storageKey).eq("key", "superconfig-private")
      .maybeSingle();
    if (error) {
      await audit(tenant.id, action, "error", error.message);
      return json({ error: "Lesing feila" }, 500);
    }
    await audit(tenant.id, action, "success");
    return json({ success: true, value: (data && data.value) || {} });
  }

  // ── set_config ───────────────────────────────────────────────────────────
  if (action === "set_config") {
    const { key, value } = body;
    if (ALLOWED_CONFIG_KEYS.indexOf(key) === -1) {
      await audit(tenant.id, action, "error", "ikkje-tillaten nøkkel: " + key);
      return json({ error: "Ikkje-tillaten nøkkel" }, 400);
    }
    const auditId = await auditStart(tenant.id, action + ":" + key);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { error } = await tenantSrvSb
      .from("store")
      .upsert({ tenant_id: storageKey, key, value }, { onConflict: "tenant_id,key" });
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Skriving feila" }, 500);
    }
    await auditFinish(auditId, "success");
    return json({ success: true });
  }

  // ── reset_config ─────────────────────────────────────────────────────────
  if (action === "reset_config") {
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { error } = await tenantSrvSb
      .from("store").delete()
      .eq("tenant_id", storageKey)
      .in("key", ALLOWED_CONFIG_KEYS);
    if (error) {
      await auditFinish(auditId, "error", error.message);
      return json({ error: "Nullstilling feila" }, 500);
    }
    await auditFinish(auditId, "success");
    return json({ success: true });
  }

  // ── upload_logo ──────────────────────────────────────────────────────────
  // Console (renderWeb()) sitt logo-opplastingsfelt. Kryssar inn i KUNDEN sitt
  // eige Storage-prosjekt via service_role (same "media"-bukett som core.js
  // sin Media.put()/putFile() alt brukar for kundens eigen biletopplasting) --
  // service_role bypassar RLS heilt, difor er filtype/storleik/SVG-sanering
  // handheva HER, ikkje tillit til klienten sine tilsvarande sjekkar (dei er
  // berre rask UX-tilbakemelding). Sjå docs/roadmap/ROADMAP.md "Later" (custom
  // design-modul-punktet) -- må gjennom Security Auditor før produksjonsbruk,
  // sidan dette er fil-opplasting/lagring (CLAUDE.md sin standardregel).
  if (action === "upload_logo") {
    const { file_base64, content_type, old_logo_url } = body;
    const ALLOWED_EXT: Record<string, string> = {
      "image/svg+xml": "svg",
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    };
    let ext = ALLOWED_EXT[content_type];
    if (!ext) {
      await audit(tenant.id, action, "error", "ikkje-tillaten filtype: " + content_type);
      return json({ error: "Berre SVG, PNG, JPEG eller WebP er tillate" }, 400);
    }
    if (!file_base64 || typeof file_base64 !== "string") {
      await audit(tenant.id, action, "error", "manglar fildata");
      return json({ error: "Manglar fildata" }, 400);
    }
    const MAX_BYTES = 300 * 1024; // endeleg lagra storleik -- uendra
    // PNG/JPEG kan komprimerast automatisk ned mot MAX_BYTES (sjå
    // compressRasterImage() over), difor kan den RÅ opplastinga vere større
    // enn 300KB for desse to filtypane. SVG og WebP kan IKKJE komprimerast
    // her (SVG er alt tekst/sanering, WebP kan ikkje dekodast av
    // imagescript) og held difor fram med MAX_BYTES som absolutt tak, som før.
    const isCompressible = ext === "png" || ext === "jpg";
    const RAW_MAX_BYTES = 6 * 1024 * 1024;
    const rawCeiling = isCompressible ? RAW_MAX_BYTES : MAX_BYTES;
    // Security Auditor pre-merge review (2026-07-16): avvis grovt overstore
    // nyttelastar FØR base64-dekoding, ikkje berre etter -- ei rå
    // base64-lengd på fleire MB skal aldri nå dekodingssteget i det heile.
    if (file_base64.length > Math.ceil((rawCeiling * 4) / 3) + 1024) {
      await audit(tenant.id, action, "error", "base64-nyttelast for stor: " + file_base64.length + " teikn");
      return json({ error: "Fila er for stor (maks " + Math.round(rawCeiling / 1024) + "KB)" }, 400);
    }
    let bytes: Uint8Array;
    try {
      bytes = base64Decode(file_base64);
    } catch (_e) {
      await audit(tenant.id, action, "error", "ugyldig base64-data");
      return json({ error: "Ugyldig fildata" }, 400);
    }
    if (bytes.length > rawCeiling) {
      await audit(tenant.id, action, "error", "fil for stor: " + bytes.length + " bytes");
      return json({ error: "Fila er for stor (maks " + Math.round(rawCeiling / 1024) + "KB)" }, 400);
    }
    // Security Auditor pre-merge review (2026-07-16), MEDIUM finding: sanering
    // var tidlegare gata på det klient-oppgjevne content_type-feltet åleine --
    // SVG-byte sende med content_type: "image/png" gjekk rett forbi
    // sanitizeSvg(). No er "ser dette faktisk ut som XML?" den avgjerande
    // sjekken, ikkje klienten sin påstand: alt som ser ut som XML/SVG vert
    // ALLTID sanert eller avvist, og ei fil som HEVDAR å vere SVG men ikkje
    // ser slik ut vert avvist (mismatch), uansett kva content_type var.
    const xmlLike = looksLikeXml(bytes);
    if (ext === "svg" && !xmlLike) {
      await audit(tenant.id, action, "error", "hevda SVG, men inneheld ikkje XML/SVG-innhald");
      return json({ error: "Fila hevdar å vere SVG, men inneheld ikkje gyldig SVG-innhald" }, 400);
    }
    if (ext !== "svg" && xmlLike) {
      await audit(tenant.id, action, "error", "hevda " + content_type + ", men inneheld XML/SVG-innhald");
      return json({ error: "Filinnhaldet stemmer ikkje med den oppgjevne filtypen" }, 400);
    }
    let uploadBytes: Uint8Array = bytes;
    let uploadContentType = content_type;
    if (xmlLike) {
      const svgText = new TextDecoder().decode(bytes);
      const sanitized = sanitizeSvg(svgText);
      if (sanitized === null) {
        await audit(tenant.id, action, "error", "SVG kunne ikkje saneras trygt");
        return json({ error: "SVG-fila kunne ikkje verifiserast som trygg og vart avvist" }, 400);
      }
      uploadBytes = new TextEncoder().encode(sanitized);
      uploadContentType = "image/svg+xml";
    } else if (isCompressible && bytes.length > MAX_BYTES) {
      const compressed = await compressRasterImage(bytes, ext, MAX_BYTES);
      if ("reason" in compressed) {
        await audit(tenant.id, action, "error", "biletet kunne ikkje komprimerast under 300KB: " + compressed.reason);
        return json({ error: "Biletet er for stort og kunne ikkje komprimerast nok automatisk. Prøv eit mindre bilete, eller last opp som JPEG." }, 400);
      }
      uploadBytes = compressed.bytes;
      if (compressed.ext !== ext) {
        // compressRasterImage() konverterte ein PNG utan verkeleg gjennomsikt
        // til JPEG for å nå måltaket -- oppdater ext/contentType tilsvarande,
        // elles vert JPEG-byte lagra med feil .png-etternamn/image/png-type.
        ext = compressed.ext;
        uploadContentType = "image/jpeg";
      }
    }
    const path = "logos/" + tenant.id + "-" + Date.now() + "." + ext;
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { error: upErr } = await tenantSrvSb.storage
      .from("media")
      .upload(path, uploadBytes, { contentType: uploadContentType, upsert: false });
    if (upErr) {
      await auditFinish(auditId, "error", upErr.message);
      return json({ error: "Opplasting feila" }, 500);
    }
    // Best-effort opprydding av det GAMLE logo-objektet (same
    // path-utleiingsmønster som core.js sin Media.free()) -- feilar denne,
    // blokkerer det ikkje den nye opplastinga, berre ein ubrukt fil vert
    // liggjande att i bøtta.
    if (typeof old_logo_url === "string" && old_logo_url.indexOf("/storage/v1/object/public/media/") > -1) {
      const oldPath = old_logo_url.split("/storage/v1/object/public/media/")[1];
      if (oldPath && oldPath.indexOf("logos/") === 0) {
        // supabase-js sitt storage.remove() kastar ikkje, det løyser til
        // { data, error } -- feilen her vert medvite ignorert (best-effort).
        await tenantSrvSb.storage.from("media").remove([decodeURIComponent(oldPath)]);
      }
    }
    const { data: pub } = tenantSrvSb.storage.from("media").getPublicUrl(path);
    await auditFinish(auditId, "success", path);
    return json({ success: true, url: pub.publicUrl });
  }

  // ── upload_section_image ─────────────────────────────────────────────────
  // Sidebygger (module-page-builder.js, Fase 1) sitt biletopplastingsfelt --
  // same service-role-kryssing/valideringsmønster som upload_logo over
  // (SVG-sanering, XML-sniffing uavhengig av oppgjeven content_type,
  // rå-storleik-avvisning FØR base64-dekoding), berre med ei anna
  // storleiksgrense: seksjonsbilete (hero/stort bilete/rutenett-ruter) er
  // fullbreidde-innhaldsbilete, same rolle som kunden sitt eige Mediabank-
  // innhald, ikkje ein liten logo -- difor eit større tak enn upload_logo
  // sine 300KB/6MB (kalibrert mot core.js sin Media.put(), MAX_DIM:1400/
  // QUALITY:0.82, som heller ikkje har noko hardt sluttak).
  if (action === "upload_section_image") {
    const { file_base64, content_type, old_image_url } = body;
    const ALLOWED_EXT: Record<string, string> = {
      "image/svg+xml": "svg",
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    };
    let ext = ALLOWED_EXT[content_type];
    if (!ext) {
      await audit(tenant.id, action, "error", "ikkje-tillaten filtype: " + content_type);
      return json({ error: "Berre SVG, PNG, JPEG eller WebP er tillate" }, 400);
    }
    if (!file_base64 || typeof file_base64 !== "string") {
      await audit(tenant.id, action, "error", "manglar fildata");
      return json({ error: "Manglar fildata" }, 400);
    }
    // Brukarønske 2026-09-03: heva stegvis frå 600KB (fyrste steg: 1MB) som
    // eit mellombels praktisk mottiltak medan komprimeringsbiblioteket
    // (imagescript) sin CDN-import framleis feilar i drift (sjå changelog
    // 0.159.14-0.159.16 for full feilsøkingshistorikk -- tre uavhengig
    // curl-verifiserte kjelder feila likevel identisk, som tyder på at
    // problemet ligg djupare enn sjølve CDN-valet). Ei fil UNDER denne
    // grensa hoppar heilt over komprimeringssteget og lastar opp direkte,
    // uavhengig av om biblioteket faktisk kan lastast -- dei fleste vanlege
    // JPEG-eksportar (telefon/kamera) hamnar under dette. Filer STØRRE enn
    // grensa treffer framleis det (no ustabile) komprimeringssporet.
    const MAX_BYTES = 1024 * 1024; // 1MB -- steg 1 av fleire, aukast vidare om dette held mål
    const isCompressible = ext === "png" || ext === "jpg";
    const RAW_MAX_BYTES = 8 * 1024 * 1024;
    const rawCeiling = isCompressible ? RAW_MAX_BYTES : MAX_BYTES;
    if (file_base64.length > Math.ceil((rawCeiling * 4) / 3) + 1024) {
      await audit(tenant.id, action, "error", "base64-nyttelast for stor: " + file_base64.length + " teikn");
      return json({ error: "Fila er for stor (maks " + Math.round(rawCeiling / 1024) + "KB)" }, 400);
    }
    let bytes: Uint8Array;
    try {
      bytes = base64Decode(file_base64);
    } catch (_e) {
      await audit(tenant.id, action, "error", "ugyldig base64-data");
      return json({ error: "Ugyldig fildata" }, 400);
    }
    if (bytes.length > rawCeiling) {
      await audit(tenant.id, action, "error", "fil for stor: " + bytes.length + " bytes");
      return json({ error: "Fila er for stor (maks " + Math.round(rawCeiling / 1024) + "KB)" }, 400);
    }
    const xmlLike = looksLikeXml(bytes);
    if (ext === "svg" && !xmlLike) {
      await audit(tenant.id, action, "error", "hevda SVG, men inneheld ikkje XML/SVG-innhald");
      return json({ error: "Fila hevdar å vere SVG, men inneheld ikkje gyldig SVG-innhald" }, 400);
    }
    if (ext !== "svg" && xmlLike) {
      await audit(tenant.id, action, "error", "hevda " + content_type + ", men inneheld XML/SVG-innhald");
      return json({ error: "Filinnhaldet stemmer ikkje med den oppgjevne filtypen" }, 400);
    }
    let uploadBytes: Uint8Array = bytes;
    let uploadContentType = content_type;
    if (xmlLike) {
      const svgText = new TextDecoder().decode(bytes);
      const sanitized = sanitizeSvg(svgText);
      if (sanitized === null) {
        await audit(tenant.id, action, "error", "SVG kunne ikkje saneras trygt");
        return json({ error: "SVG-fila kunne ikkje verifiserast som trygg og vart avvist" }, 400);
      }
      uploadBytes = new TextEncoder().encode(sanitized);
      uploadContentType = "image/svg+xml";
    } else if (isCompressible && bytes.length > MAX_BYTES) {
      const compressed = await compressRasterImage(bytes, ext, MAX_BYTES);
      if ("reason" in compressed) {
        await audit(tenant.id, action, "error", "biletet kunne ikkje komprimerast under " + Math.round(MAX_BYTES / 1024) + "KB: " + compressed.reason);
        return json({ error: "Biletet er for stort og kunne ikkje komprimerast nok automatisk. Prøv eit mindre bilete, eller last opp som JPEG." }, 400);
      }
      uploadBytes = compressed.bytes;
      if (compressed.ext !== ext) {
        // Sjå tilsvarande kommentar i upload_logo -- PNG utan gjennomsikt
        // vart JPEG-konvertert for å nå måltaket.
        ext = compressed.ext;
        uploadContentType = "image/jpeg";
      }
    }
    const path = "sections/" + tenant.id + "-" + Date.now() + "." + ext;
    const auditId = await auditStart(tenant.id, action);
    if (!auditId) return json({ error: "Audit-logg kunne ikkje skrivast — handling avbrote" }, 500);
    const { error: upErr } = await tenantSrvSb.storage
      .from("media")
      .upload(path, uploadBytes, { contentType: uploadContentType, upsert: false });
    if (upErr) {
      await auditFinish(auditId, "error", upErr.message);
      return json({ error: "Opplasting feila" }, 500);
    }
    // Best-effort opprydding av det GAMLE seksjonsbiletet (same mønster som
    // upload_logo sin old_logo_url-handtering) -- feilar denne, blokkerer det
    // ikkje den nye opplastinga, berre ein ubrukt fil vert liggjande att.
    if (typeof old_image_url === "string" && old_image_url.indexOf("/storage/v1/object/public/media/") > -1) {
      const oldPath = old_image_url.split("/storage/v1/object/public/media/")[1];
      if (oldPath && oldPath.indexOf("sections/") === 0) {
        await tenantSrvSb.storage.from("media").remove([decodeURIComponent(oldPath)]);
      }
    }
    const { data: pub } = tenantSrvSb.storage.from("media").getPublicUrl(path);
    await auditFinish(auditId, "success", path);
    // size = den faktiske, ENDELEGE storleiken (etter evt. komprimering) --
    // UX-funn 2026-08-11: operatøren kunne ikkje sjå kva komprimeringa
    // faktisk resulterte i, berre at ho skjedde. Console bruker dette til å
    // vise "komprimert frå X til Y" i staden for berre "✓ Lasta opp".
    return json({ success: true, url: pub.publicUrl, size: uploadBytes.length });
  }

  // ── get_tenant_status ────────────────────────────────────────────────────
  // Extends the Phase 7 broker-ping mechanism-proof into something an
  // operator dashboard can actually use — read-only, same risk profile.
  if (action === "get_tenant_status") {
    const { data: listResult, error: listErr } = await tenantSrvSb.auth.admin.listUsers({ perPage: 1 });
    if (listErr) {
      await audit(tenant.id, action, "error", listErr.message);
      return json({ error: "Kryss-prosjekt-kall feila", reachable: false }, 500);
    }
    await audit(tenant.id, action, "success");
    return json({
      success: true,
      tenant_slug: tenant.slug,
      reachable: true,
      user_count: typeof listResult.total === "number" ? listResult.total : listResult.users.length,
    });
  }

  await audit(tenant.id, String(action), "error", "ukjend handling");
  return json({ error: "Ukjend handling: " + action }, 400);
});
