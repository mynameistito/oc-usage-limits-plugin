import { afterEach, mock } from "bun:test";

const originalFetch = globalThis.fetch;
type FetchMock = (
  url: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;
// SAFETY: The mock implements the fetch call signature used by provider tests.
const asFetch = <T>(value: T): typeof fetch => value as typeof fetch;

export const installFetchMock = (response: Response) => {
  const fetchMock = mock<FetchMock>(() => Promise.resolve(response));
  // SAFETY: The mock implements the subset of fetch used by provider tests.
  globalThis.fetch = asFetch(fetchMock);
  return fetchMock;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OC_USAGE_LIMITS_ZAI_KEY;
  delete process.env.OC_USAGE_LIMITS_SYNTHETIC_KEY;
  delete process.env.OC_USAGE_LIMITS_MINIMAX_KEY;
  mock.restore();
});
