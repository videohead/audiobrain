import { createSocket } from 'node:dgram';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const protocol = 'audiobrain.osc.v1';
const validAddress = address => typeof address === 'string' && /^\/[A-Za-z0-9_/-]{1,127}$/.test(address);
export function encodeOscFloat(address, value) {
  if (!validAddress(address) || typeof value !== 'number' || !Number.isFinite(Math.fround(value))) throw new Error('Expected one finite OSC float at a literal address.');
  const offset = Math.ceil((Buffer.byteLength(address) + 1) / 4) * 4;
  const packet = Buffer.alloc(offset + 8);
  packet.write(address); packet.write(',f', offset); packet.writeFloatBE(value, offset + 4);
  return packet;
}
export function decodeOscFloat(packet) {
  if (!Buffer.isBuffer(packet) || packet.length > 256 || packet.length < 12) return null;
  const end = packet.indexOf(0);
  if (end < 0) return null;
  const address = packet.toString('utf8', 0, end);
  const offset = Math.ceil((end + 1) / 4) * 4;
  if (!validAddress(address) || packet.length !== offset + 8 || packet.toString('utf8', offset, offset + 4) !== ',f\0\0') return null;
  const value = packet.readFloatBE(offset + 4);
  return Number.isFinite(value) ? { protocol, address, args: [{ type: 'f', value }] } : null;
}
export async function startOscGateway({
  port = 8787, listenPort = 9001, targetPort = 9000, targetHost = '127.0.0.1', bindHost = '127.0.0.1',
  allowedOrigins = ['https://audiobrain.org', 'http://127.0.0.1:5178', 'http://localhost:5178'],
  tls,
} = {}) {
  if (![port, listenPort, targetPort].every(value => Number.isInteger(value) && value >= 0 && value <= 65535)) throw new Error('Invalid gateway port.');
  if (!allowedOrigins.length || allowedOrigins.some(origin => new URL(origin).origin !== origin)) throw new Error('Configure exact allowed origins.');
  const server = tls ? createHttpsServer(tls) : createHttpServer();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const udp = createSocket('udp4');
  const origins = new Set(allowedOrigins);
  server.on('request', (_request, response) => { response.writeHead(404); response.end(); });
  server.on('upgrade', (request, socket, head) => {
    if (!origins.has(request.headers.origin) || sockets.clients.size >= 4 || request.url !== '/') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client));
  });
  sockets.on('connection', socket => {
    let started = Date.now(); let count = 0;
    socket.on('error', () => socket.close());
    socket.on('message', (data, isBinary) => {
      if (Date.now() - started >= 1000) { started = Date.now(); count = 0; }
      if (isBinary || data.length > 4096 || ++count > 60) return;
      try {
        const message = JSON.parse(data.toString());
        if (message.protocol !== protocol || !Array.isArray(message.args) || message.args.length !== 1 || message.args[0]?.type !== 'f') return;
        const packet = encodeOscFloat(message.address, message.args[0].value);
        udp.send(packet, targetPort, targetHost, error => { if (error) socket.close(1011, 'UDP destination unavailable'); });
      } catch { /* Invalid packets never reach UDP. */ }
    });
  });
  let inboundStart = Date.now(); let inboundCount = 0;
  udp.on('message', packet => {
    if (Date.now() - inboundStart >= 1000) { inboundStart = Date.now(); inboundCount = 0; }
    if (++inboundCount > 60) return;
    const message = decodeOscFloat(packet);
    if (!message) return;
    const data = JSON.stringify(message);
    for (const socket of sockets.clients) if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 65536) socket.send(data);
  });
  let closing;
  const close = () => closing ??= Promise.all([
    new Promise(resolve => { for (const socket of sockets.clients) socket.terminate(); sockets.close(); server.close(resolve); }),
    new Promise(resolve => { try { udp.close(resolve); } catch { resolve(); } }),
  ]).then(() => undefined);
  const startup = await Promise.allSettled([
    new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, bindHost, resolve); }),
    new Promise((resolve, reject) => { udp.once('error', reject); udp.bind(listenPort, bindHost, resolve); }),
  ]);
  const failed = startup.find(result => result.status === 'rejected');
  if (failed) { await close(); throw failed.reason; }
  udp.on('error', () => { for (const socket of sockets.clients) socket.close(1011, 'UDP socket failed'); });
  return {
    port: server.address().port,
    listenPort: udp.address().port,
    close,
  };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const certFile = process.env.OSC_TLS_CERT_FILE; const keyFile = process.env.OSC_TLS_KEY_FILE;
  if (Boolean(certFile) !== Boolean(keyFile)) throw new Error('Configure both TLS certificate and key files.');
  const gateway = await startOscGateway({
    port: Number(process.env.OSC_WS_PORT ?? 8787), listenPort: Number(process.env.OSC_LISTEN_PORT ?? 9001),
    targetPort: Number(process.env.OSC_TARGET_PORT ?? 9000), targetHost: process.env.OSC_TARGET_HOST ?? '127.0.0.1',
    bindHost: process.env.OSC_BIND_HOST ?? '127.0.0.1',
    ...(process.env.OSC_ALLOWED_ORIGINS ? { allowedOrigins: process.env.OSC_ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean) } : {}),
    ...(certFile && keyFile ? { tls: { cert: readFileSync(certFile), key: readFileSync(keyFile) } } : {}),
  });
  console.log(`AudioBrain OSC gateway: ${certFile ? 'wss' : 'ws'}://127.0.0.1:${gateway.port}; UDP input 127.0.0.1:${gateway.listenPort}`);
  const stop = () => { void gateway.close().then(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
