import { describe, expect, it } from 'vitest';
import { secretChangeRequest } from '../src/components/settings/McpSecretChange.tsx';

/* "Cambia il token" (D-072): only the chosen secret changes, the others are kept (empty). */

describe('secretChangeRequest', () => {
  it('changes one header and keeps the others', () => {
    const server = {
      transport: 'http' as const,
      envKeys: [],
      headerKeys: ['Authorization', 'X-Extra'],
    };
    expect(secretChangeRequest(server, 'Authorization', 'Bearer nuovo')).toEqual({
      headers: { Authorization: 'Bearer nuovo', 'X-Extra': '' },
    });
    // The header of the catalog with another case replaces the saved one, never a second one.
    expect(secretChangeRequest(server, 'authorization', 'Bearer nuovo')).toEqual({
      headers: { Authorization: 'Bearer nuovo', 'X-Extra': '' },
    });
  });

  it('changes a variable of a program on the computer', () => {
    const server = { transport: 'stdio' as const, envKeys: ['API_KEY', 'REGION'], headerKeys: [] };
    expect(secretChangeRequest(server, 'API_KEY', 'nuovo')).toEqual({
      env: { API_KEY: 'nuovo', REGION: '' },
    });
  });
});
