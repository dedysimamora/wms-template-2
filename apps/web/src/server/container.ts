import { createContainer, type Container } from '@wms/infrastructure';

const g = globalThis as unknown as { __wmsContainer?: Container };

/** Composition root web (ADR-002). Satu instance per proses (aman terhadap HMR dev). */
export function container(): Container {
  g.__wmsContainer ??= createContainer(undefined, 'wms-web');
  return g.__wmsContainer;
}
