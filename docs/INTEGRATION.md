# Live controls between AudioBrain, VideoBrain and OSC

AudioBrain's browser adapters connect existing graph inputs and outputs to an
explicitly paired session. VideoBrain's companion connects explicitly selected
numeric parameters in its existing project store. Neither adapter requests device
permission, opens a network connection or changes a parameter until the user
connects it.

## VideoBrain pairing

Open VideoBrain from AudioBrain's connection action. The new top-level window's
fragment carries the AudioBrain origin and a fresh random pairing nonce. In
VideoBrain, select the parameter/channel mappings and enable the connection.
Both windows must remain open. Disconnect tears down listeners and timers;
closing the peer or losing its heartbeat also disconnects the session.

The wire protocol is `brain.control.v1`. It uses `window.postMessage` with an
exact target origin. Incoming messages require the exact peer window, origin,
nonce/session and a strictly increasing sequence number. A handshake must complete
before controls are accepted. Unknown or unmapped channels, invalid numeric
values, oversized messages and stale/replayed sequences are ignored. Limits are
64 configured channels, 4 KiB per message and 60 control messages per second in
each direction. Repeated values and direct same-value echoes are suppressed.
A heartbeat detects navigation or a lost peer within about eleven seconds.

There is no cross-origin BroadcastChannel or iframe assumption. AudioBrain and
VideoBrain remain separate top-level applications, compatible with their current
framing policies. Future cross-origin isolation policies must preserve or replace
the opener-based pairing mechanism deliberately.

### Saved names and direction

AudioBrain's Brain nodes retain their existing `channel` and `name` parameters.
Their canonical wire name joins them with `/`; for example the defaults produce
`audiobrain-v1/value`. Use up to 128 ASCII letters, digits, underscores, dots,
slashes, colons or hyphens in the complete name. A VideoBrain mapping uses that
same complete name.

| Direction | AudioBrain | VideoBrain |
| --- | --- | --- |
| AudioBrain → VideoBrain | Connect a scalar to Brain Control Out; its evaluated `value` snapshot is published | Map the matching channel to an existing numeric parameter, such as XY Pad X |
| VideoBrain → AudioBrain | Brain Control In receives the selected channel; connect its scalar output to the intended control | Map an existing numeric parameter's saved literal, such as XY Pad Y, to an outgoing channel |

Use distinct names for independent directions. Incoming VideoBrain controls pass
through its production store command and clamp to the selected parameter's
registry limits. These updates change saved literals. An already connected
VideoBrain wire retains the existing graph's override behavior. Outgoing
VideoBrain values are **saved numeric literals**, not shader runtime results or
resolved connected values. Runtime graph output roots, event transport and audio
streams are future extensions. AudioBrain output uses its evaluated control
snapshots, not audio samples; this bridge does not promise sample-accurate timing.

The companion recognizes `https://audiobrain.org`,
`http://127.0.0.1:5178` and `http://localhost:5178`. AudioBrain can open an explicit
HTTPS VideoBrain URL or a loopback development URL. Other origins require a
reviewed allowlist change; the pairing fragment alone never grants access.

### Adapter API

`src/adapters/brainBridge.ts` exposes `openBrainPeer`, `readBrainPairing` and
`attachBrainBridge`. `bindRuntimeControls` in `src/adapters/runtimeControls.ts`
reads the actual project nodes and runtime snapshots; it returns selected
channels, an inbound control handler and disposal. Recreate the binding when the
project or mapping changes. Session windows and sockets are never serialized.

VideoBrain's `src/integrations/brainBridge.ts` contains the same versioned
transport plus `connectMappedBrainParameters`. Each mapping explicitly names
`channel`, `nodeId`, `paramId` and direction `in` or `out`. Its registry and
project store remain the authorities for valid parameters and bounds.

## OSC gateway

A browser cannot send or receive OSC UDP directly. AudioBrain connects to an
explicit WebSocket gateway using this JSON contract:

```json
{"protocol":"audiobrain.osc.v1","address":"/audiobrain/control","args":[{"type":"f","value":0.5}]}
```

This first adapter carries one finite OSC 32-bit float at a literal address.
Addresses begin with `/` and use ASCII letters, digits, underscores, slashes and
hyphens, up to 128 characters. OSC bundles, wildcard subscriptions, strings,
multiple arguments and timetags are not implemented. Each OSC In/Out node selects
one explicit address; unknown addresses are ignored. The adapter bounds traffic
and queued bytes, suppresses direct echoes and closes its socket on disconnect.

A real local UDP gateway is included:

```sh
npm run osc:gateway
```

By default it listens for browser connections at `ws://127.0.0.1:8787`, accepts
OSC UDP on `127.0.0.1:9001`, and sends outgoing OSC to `127.0.0.1:9000`. Configure
an external instrument's receive port as 9000 and send port as 9001. The gateway
uses actual OSC string padding/type tags and big-endian float packets.

| Environment variable | Default / purpose |
| --- | --- |
| `OSC_WS_PORT` | `8787`, WebSocket listen port, loopback binding |
| `OSC_LISTEN_PORT` | `9001`, incoming UDP port, loopback binding |
| `OSC_TARGET_HOST` | `127.0.0.1`, fixed configured outgoing UDP host |
| `OSC_TARGET_PORT` | `9000`, fixed configured outgoing UDP port |
| `OSC_BIND_HOST` | `127.0.0.1`; set `0.0.0.0` only inside a container whose published ports stay on host loopback (see Docker) |
| `OSC_ALLOWED_ORIGINS` | Optional comma-separated exact origins replacing the three defaults |
| `OSC_TLS_CERT_FILE` / `OSC_TLS_KEY_FILE` | Optional trusted certificate and key files; configure both to serve WSS |

The browser cannot choose a UDP destination in a message. Only the configured
server-side host and port receive outgoing data. The gateway accepts the same
three AudioBrain origins listed above, at most four clients, 4 KiB messages and
60 packets per second in each direction. Its loopback listener is intentional.

A locally served AudioBrain may use loopback `ws://`. Hosted AudioBrain requires
`wss://`, including when talking to a local gateway; supply a browser-trusted TLS
certificate or an explicitly configured secure reverse proxy. The static AWS
site does not deploy this gateway or hold its TLS key. Do not expose the gateway
as an unauthenticated public UDP relay.

Browser tests use deterministic message/socket fixtures. The gateway tests also
exchange real packets between an ephemeral loopback UDP socket and a WebSocket
client, and verify that an unapproved browser origin is refused.

## Docker

`docker compose up --build` serves the production build with nginx at
`http://127.0.0.1:5178` and runs the OSC gateway in a second container
(`ws://127.0.0.1:8787`, UDP `127.0.0.1:9001`). Both ports are published on host
loopback only; inside the container the gateway binds `0.0.0.0` through
`OSC_BIND_HOST` because Docker's port proxy cannot reach a container loopback.
Outgoing OSC goes to `host.docker.internal:9000` by default; override with
`OSC_TARGET_HOST`/`OSC_TARGET_PORT` in `.env` (see `.env.example`). Use
`docker compose --profile dev up audiobrain-dev` for the Vite dev server and
`--profile storybook` for Storybook, both bind-mounting the source.
