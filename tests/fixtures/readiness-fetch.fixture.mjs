// Offline subprocess fixture: no provider traffic and no credential values are read.
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.origin !== 'https://api.ipgeolocation.io' || url.pathname !== '/v3/user-agent') {
    throw new Error('Unexpected fixture destination');
  }
  if (typeof JSON.parse(init.body).uaString !== 'string') throw new Error('Expected explicit UA data');
  return new Response('{"user_agent_string":"synthetic-framing-result"}');
};
