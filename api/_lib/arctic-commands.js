// Production-facing command catalogue for Console's Arctic section.
// Entries describe future gateway actions; this module never executes them.

var DEFINITIONS = [
  { id: "health", input: "health", label: "Helse", description: "Hent avgrenset systemhelse for Arctic." },
  { id: "services", input: "services", label: "Tjenester", description: "Hent status for eksplisitt registrerte Vibeverk-tjenester." },
  { id: "gemma-status", input: "gemma status", label: "Gemma-status", description: "Kontroller om den registrerte lokale modellen er tilgjengelig." },
  { id: "sessions", input: "sessions", label: "Arbeidsøkter", description: "Hent aktive og nylige Vibeverk-arbeidsøkter." },
  { id: "log-errors-24h", input: "logs errors --last 24h", label: "Feil siste døgn", description: "Hent filtrerte Vibeverk-feilhendelser fra siste døgn." },
  { id: "backup-status", input: "backup status", label: "Backup-status", description: "Hent status for den avgrensede Vibeverk-backupen." },
  { id: "vibeverk-test", input: "vibeverk test", label: "Vibeverk-tester", description: "Kjør det registrerte Vibeverk-testsettet i et avgrenset arbeidsområde." },
  { id: "deploy-status", input: "deploy status", label: "Deploy-status", description: "Hent status for registrerte Vibeverk-utrullinger." }
];

export function commandRegistry() {
  return DEFINITIONS.map(function (definition) {
    return {
      id: definition.id,
      input: definition.input,
      label: definition.label,
      description: definition.description,
      availability: "unavailable",
      available: false,
      mutatesState: false,
      reasonCode: "gateway_required"
    };
  });
}

export function parseArcticCommand(value) {
  if (typeof value !== "string") {
    return { ok: false, code: "invalid_command", message: "Kommandoen må være tekst." };
  }
  if (!value.trim() || value.length > 200) {
    return { ok: false, code: "invalid_command", message: "Kommandoen er tom eller for lang." };
  }
  // Defense in depth: the registry below already requires an exact match,
  // but reject shell syntax explicitly before normalization so it can never
  // acquire meaning if a gateway adapter is added later.
  if (/[\0\r\n;'"\\|&<>`$(){}\[\]]/.test(value)) {
    return { ok: false, code: "unsafe_command", message: "Shelloperatorer og kommandosubstitusjon er ikke tillatt." };
  }
  var canonical = value.trim().toLowerCase().replace(/\s+/g, " ");
  var definition = DEFINITIONS.filter(function (item) { return item.input === canonical; })[0];
  if (!definition) {
    return { ok: false, code: "command_not_allowed", message: "Kommandoen er ikke registrert for Arctic." };
  }
  return { ok: true, command: { id: definition.id, input: definition.input } };
}
