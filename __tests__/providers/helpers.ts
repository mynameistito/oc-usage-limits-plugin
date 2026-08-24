import { afterEach, mock } from "bun:test";

const originalFetch = globalThis.fetch;
type FetchMock = (
  url: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export const installFetchMock = (response: Response) => {
  const fetchMock = mock<FetchMock>(() => Promise.resolve(response));
  // SAFETY: Bun's mock function has the same call signature as global fetch.
  globalThis.fetch = Object.assign(fetchMock, {
    preconnect: originalFetch.preconnect,
  });
  return fetchMock;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OC_USAGE_LIMITS_ZAI_KEY;
  delete process.env.OC_USAGE_LIMITS_SYNTHETIC_KEY;
  delete process.env.OC_USAGE_LIMITS_MINIMAX_KEY;
  mock.restore();
});
