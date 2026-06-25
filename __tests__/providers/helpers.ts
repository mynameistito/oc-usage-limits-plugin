import { afterEach, mock } from "bun:test";

const originalFetch = globalThis.fetch;
type FetchMock = (
  url: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export const installFetchMock = (response: Response) => {
  const fetchMock = mock<FetchMock>(() => Promise.resolve(response));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OC_USAGE_LIMITS_ZAI_KEY;
  delete process.env.OC_USAGE_LIMITS_SYNTHETIC_KEY;
  delete process.env.OC_USAGE_LIMITS_MINIMAX_KEY;
  mock.restore();
});
