// Minimal MCP client over streamable HTTP for the fake harnesses: initialize,
// then one tools/call. Answers may be JSON or a short SSE stream.

async function rpc(url, token, body, session) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': '2025-06-18',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) return { status: res.status, error: text };
  if (!text.trim()) return { status: res.status, session: res.headers.get('mcp-session-id') };
  let payload = text;
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    payload = data.at(-1) ?? '{}';
  }
  return {
    status: res.status,
    message: JSON.parse(payload),
    session: res.headers.get('mcp-session-id'),
  };
}

export async function callMcpTool(url, token, name, args) {
  const init = await rpc(url, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fake-harness', version: '1.0.0' },
    },
  });
  if (init.error) return { status: init.status, error: init.error };
  const session = init.session ?? undefined;
  await rpc(url, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);
  const list = await rpc(url, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session);
  const call = await rpc(
    url,
    token,
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } },
    session,
  );
  return {
    status: call.status,
    tools: list.message?.result?.tools?.map((t) => t.name) ?? [],
    result: call.message?.result,
    error: call.error ?? call.message?.error,
  };
}
