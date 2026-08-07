// supabase/functions/sidetelling-event/index.ts
//
// Tynn Deno-entrypoint. Den reine handleren ligg i handler.js slik at den
// same produksjonslogikken kan åtferdstestast dependency-fritt i Node 20.

import { handleSidetellingEvent } from "./handler.js";

export { handleSidetellingEvent };

Deno.serve(function (req) { return handleSidetellingEvent(req); });
