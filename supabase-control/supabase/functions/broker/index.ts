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
const ALLOWED_CONFIG_KEYS = ["superconfig", "superconfig-private", "analytics"];

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
    const ext = ALLOWED_EXT[content_type];
    if (!ext) {
      await audit(tenant.id, action, "error", "ikkje-tillaten filtype: " + content_type);
      return json({ error: "Berre SVG, PNG, JPEG eller WebP er tillate" }, 400);
    }
    if (!file_base64 || typeof file_base64 !== "string") {
      await audit(tenant.id, action, "error", "manglar fildata");
      return json({ error: "Manglar fildata" }, 400);
    }
    const MAX_BYTES = 300 * 1024; // logo, ikkje eit generelt medie-vedlegg
    // Security Auditor pre-merge review (2026-07-16): avvis grovt overstore
    // nyttelastar FØR base64-dekoding, ikkje berre etter -- ei rå
    // base64-lengd på fleire MB skal aldri nå dekodingssteget i det heile.
    if (file_base64.length > Math.ceil((MAX_BYTES * 4) / 3) + 1024) {
      await audit(tenant.id, action, "error", "base64-nyttelast for stor: " + file_base64.length + " teikn");
      return json({ error: "Fila er for stor (maks 300KB)" }, 400);
    }
    let bytes: Uint8Array;
    try {
      bytes = base64Decode(file_base64);
    } catch (_e) {
      await audit(tenant.id, action, "error", "ugyldig base64-data");
      return json({ error: "Ugyldig fildata" }, 400);
    }
    if (bytes.length > MAX_BYTES) {
      await audit(tenant.id, action, "error", "fil for stor: " + bytes.length + " bytes");
      return json({ error: "Fila er for stor (maks 300KB)" }, 400);
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
