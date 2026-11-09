/** Query string dari objek; nilai kosong/undefined dibuang. */
export const qs = (q: object) =>
  new URLSearchParams(
    Object.entries(q)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
