import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Start PG14 untuk uji integrasi, dengan batas waktu + 1× retry. Mitigasi hang intermiten
 * Testcontainers yang teramati di Docker Desktop (2 dari ±10 run, akar masalah belum diketahui):
 * gagal cepat & jelas alih-alih menggantung sampai hookTimeout.
 */
export async function startPostgres(
  image = 'postgres:14',
  timeoutMs = 45_000,
): Promise<StartedPostgreSqlContainer> {
  for (let attempt = 1; ; attempt++) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        new PostgreSqlContainer(image).withStartupTimeout(timeoutMs).start(),
        new Promise<never>((_, rej) => {
          timer = setTimeout(
            () => rej(new Error(`Testcontainers: start ${image} > ${timeoutMs}ms`)),
            timeoutMs + 5_000,
          );
        }),
      ]);
    } catch (e) {
      if (attempt >= 2) throw e;
      console.warn(
        `[testcontainers] percobaan ${attempt} gagal: ${(e as Error).message} — mengulang`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
