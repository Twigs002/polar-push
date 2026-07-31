// Operation Polar Push — scoring engine (single source of truth on the client).
// Mirrors the `points` GENERATED column in the Supabase migration exactly.
//
// Rules (from the competition brief):
//   Points step up one full bracket every R5 000 000 of deal value.
//     bracket = floor(value / 5 000 000) + 1
//       Under R5m ............ bracket 1
//       R5m  to  R10m ........ bracket 2   (R5 000 000 counts as bracket 2)
//       R10m to  R15m ........ bracket 3
//       R15m and above ....... bracket 4, +1 bracket every extra R5m
//
//   Base points per bracket, by deal type:
//     Sole mandate .......................... 2   (2, 4, 6, 8, …)
//     Dual mandate / Signed open mandate .... 1   (1, 2, 3, 4, …)
//     Sale OTP / Lease ...................... 4   (4, 8, 12, 16, …)
//
//   points = base × bracket
window.POINTS = (() => {
  const BRACKET_SIZE = 5_000_000;

  // Canonical deal types. `label` drives the admin dropdown; `base` is the
  // per-bracket point value; `group` buckets them for the standings breakdown.
  const TYPES = [
    { key: "sole",  base: 2, label: "Sole mandate",          group: "Mandates" },
    { key: "dual",  base: 1, label: "Dual mandate",          group: "Mandates" },
    { key: "open",  base: 1, label: "Signed open mandate",   group: "Mandates" },
    { key: "otp",   base: 4, label: "Sale (OTP)",            group: "Sales" },
    { key: "lease", base: 4, label: "Lease",                 group: "Sales" },
  ];
  const BY_KEY = Object.fromEntries(TYPES.map(t => [t.key, t]));

  function bracket(valueRand) {
    const v = Math.max(0, Number(valueRand) || 0);
    return Math.floor(v / BRACKET_SIZE) + 1;
  }

  function points(dealType, valueRand) {
    const t = BY_KEY[dealType];
    if (!t) return 0;
    return t.base * bracket(valueRand);
  }

  // "R5m–R10m" style label for the bracket a value falls into.
  function bracketLabel(valueRand) {
    const b = bracket(valueRand);
    const lo = (b - 1) * 5;
    const hi = b * 5;
    return b === 1 ? "Under R5m" : `R${lo}m–R${hi}m`;
  }

  function typeLabel(dealType) {
    return (BY_KEY[dealType] || {}).label || dealType;
  }

  function typeGroup(dealType) {
    return (BY_KEY[dealType] || {}).group || "Other";
  }

  return { TYPES, BY_KEY, BRACKET_SIZE, bracket, points, bracketLabel, typeLabel, typeGroup };
})();
