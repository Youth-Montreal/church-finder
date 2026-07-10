import { verifySessionToken, exchangeHostAccessCode } from './repository.js';

export async function authenticateAdm({ accessCode }) {
  const session = await verifySessionToken({ role: 'adm', accessCode });
  if (!session?.valid) return null;
  return session;
}

export async function authenticateHost({ accessCode }) {
  const hostSession = await exchangeHostAccessCode(accessCode);
  if (!hostSession?.token) return null;
  const session = await verifySessionToken({ role: 'host', token: hostSession.token });
  if (!session?.valid) return null;
  return { ...session, token: hostSession.token, accountId: hostSession.accountId, hostMembership: hostSession.hostMembership };
}
