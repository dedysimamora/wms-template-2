import type { Db } from '@wms/db';
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);
