/* =============================================================================
   hub/tenants.js  —  Vibeverk Operator Hub: tenantregister
   Rediger denne fila for å leggje til / endre permanente kundedata.
   Status og notat kan også endrast i Hub-UI (lagrast i localStorage).
   ============================================================================= */
window.HUB_CONFIG = {

  /* Passord for Hub-innlogging — ENDRE DETTE */
  password: "vibeverk-hub",

  tenants: [
    {
      id:               "nordpunkt",
      name:             "Nordpunkt",
      plan:             "full",          /* "web" | "workspace" | "full" */
      status:           "pilot",         /* "active" | "pilot" | "inactive" */
      webUrl:           "https://nordpunkt.no",
      workspaceUrl:     "https://nordpunkt.no/intranet/",
      consoleUrl:       "https://nordpunkt.no/console/",
      supabaseProject:  "clzczbyklgdtdhgjphup",
      contact: {
        name:  "Frode Hammerstad",
        email: "froham90@gmail.com"
      },
      since:  "2026-01",
      notes:  "Testmiljø / pilot"
    }
  ]
};
