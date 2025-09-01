// index.js
import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import express from 'express';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import basicAuth from 'basic-auth';
import wisp from 'wisp-server-node';
import { WebSocketServer } from 'ws';
import BotAPI from './bot.js';
import proxyAPI from './proxyAPI.js';

// FIX: Import the 'cookie' package to parse cookies in the upgrade handler
import cookie from 'cookie';

// Proprietary encoder/decoder
import { encrypt as encode, decode } from './encode-decode.js';
import { uvPath } from '@titaniumnetwork-dev/ultraviolet';
import { baremuxPath } from '@mercuryworkshop/bare-mux/node';
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";

// --- CONFIGURATION ---
const MASTER_USER = process.env.MASTER_USER || 'uv-master';
const MASTER_PASS = process.env.MASTER_PASS || 'enable-proxy-mode';
const COOKIE_NAME = 'proxy_access';
const pingUrls = [];
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicPath = join(__dirname, 'public');
const secretPath = join(__dirname, 'proxy');

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
};

const app = express();

app.use(cookieParser());
app.use(express.json());
setInterval(async() => {
  try{
    var promises = pingUrls.map(url => axios.get(url));
    var res = await Promise.all(promises);
    console.log("Health check pings fulfilled for " + pingUrls.join(", "));
  } catch(e){
    console.log("Health check pings failed for " + pingUrls.join(", "));
    console.log(e.message);
  }
}, 10000);
// FIX #1: Add a middleware that applies SharedWorker headers to all authenticated requests.
// This ensures that the main HTML page gets the correct headers, which is crucial.
app.use((req, res, next) => {
  var origin = req.protocol + '://' + req.get('host');
  if(!pingUrls.includes(origin)){
    pingUrls.push(origin);
  }
  const ip = req.headers["x-forwarded-for"] || "true";
  if (req.cookies[COOKIE_NAME] === encode(ip)) {
    // These headers are required for the SharedWorker to function.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }
  next();
});

// Static file servers
const secretStatic = express.static(secretPath);
const publicStatic = express.static(publicPath);
const uvStatic = express.static(uvPath);
const baremuxStatic = express.static(baremuxPath);
const libcurlStatic = express.static(libcurlPath);

// Serve correct frontend based on authentication
app.use('/', (req, res, next) => {
  const ip = req.headers["x-forwarded-for"] || "true";
  if (req.cookies[COOKIE_NAME] === encode(ip)) {
    return secretStatic(req, res, next);
  } else {
    return publicStatic(req, res, next);
  }
});

// Serve proxy assets if authenticated
app.use('/uv/', uvStatic);
app.use('/lcl', libcurlStatic);
app.use('/bm', baremuxStatic);


// API to encode a link
app.post('/api/encode', (req, res) => {
  const { url, username, password } = req.body;
  if (!url || !username || !password) {
    return res.status(400).json({ message: 'URL, username, and password required' });
  }
  const data = encode({ url, username, password });
  if (!data) {
    return res.status(500).json({ message: 'Failed to encode' });
  }
  res.json({ data });
});

// Dynamic redirect route with Basic auth
app.get('/r/:data', (req, res) => {
  const creds = basicAuth(req);

  if (!creds) {
    res.set(NO_CACHE_HEADERS);
    res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
    return res.status(401).send('Authentication required.');
  }

  const { name: user, pass } = creds;
  const { data } = req.params;

  // Master creds unlock proxy mode
  if (user === MASTER_USER && pass === MASTER_PASS) {
    const ip = req.headers["x-forwarded-for"] || "true";
    res.set(NO_CACHE_HEADERS);
    res.cookie(COOKIE_NAME, encode(ip), {
      path: '/', httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'strict'
    });
    return res.redirect('/');
  }

  // Otherwise, link-specific creds
  const payload = decode(data);
  if (!payload || !payload.url || !payload.username || !payload.password) {
    return res.status(400).send('Invalid link data.');
  }
  if (user === payload.username && pass === payload.password) {
    res.set(NO_CACHE_HEADERS);
    return res.redirect(302, payload.url);
  }

  res.set(NO_CACHE_HEADERS);
  res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
  return res.status(401).send('Invalid credentials.');
});

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(join(publicPath, '404.html'));
});
const proxyBot = new BotAPI.ProxyBotAPI({ proxyAPI });

// <<< NEW: Create the WebSocket Server >>>
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
    console.log('Dashboard client connected.');

    // Function to send data back to the client
    const send = (command, data, status = 'success', error = null) => {
        ws.send(JSON.stringify({ command, status, data, error }));
    };

ws.on('message', async (message) => {
    try {
        const parsed = JSON.parse(message);
        const { command, params } = parsed;

        console.log(`Received command from dashboard: ${command}`);

        switch (command) {
            case 'getCacheStatus': {
                const status = proxyBot.getCacheStatus();
                send(command, status);
                break;
            }
            case 'getProxies': {
                if (!params || !params.type || !params.filter) {
                    return send(command, null, 'error', 'Missing parameters: type and filter are required.');
                }
                // CRITICAL: Always use forceRefresh: false to ensure users can only get from cache.
                const result = await proxyBot.getProxies(params.type, params.filter, params.count, {
                    forceRefresh: false
                });
                send(command, result);
                break;
            }
            default:
                // If the command is not 'getCacheStatus' or 'getProxies', it's unknown and rejected.
                console.log(`Denied unknown command from dashboard: ${command}`);
                send(command, null, 'error', 'Access Denied: Unknown or forbidden command.');
        }
    } catch (err) {
        console.error('Error processing WebSocket message:', err);
        ws.send(JSON.stringify({ status: 'error', error: 'Invalid message format or server error.' }));
    }
});

    ws.on('close', () => {
        console.log('Dashboard client disconnected.');
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

const server = createServer(app);

// FIX #2: Correctly authenticate the Wisp WebSocket connection
server.on('upgrade', (req, socket, head) => {
  socket.on('error', (err) => {
    console.error('Socket error on upgrade:', err);
    socket.destroy();
  });
  const ip = req.headers["x-forwarded-for"] || "true";
  const cookies = cookie.parse(req.headers.cookie || '');
  const isAuthenticated = cookies[COOKIE_NAME] === encode(ip);
  
  if (!isAuthenticated) {
    console.log('Upgrade request denied: not authenticated.');
    return socket.destroy();
  }
  if (req.url === '/api-ws') {
    console.log('Routing to API WebSocket...');
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
  } 
  // Route to Wisp
  else if (req.url.endsWith('/wisp/')) {
    console.log('Routing to Wisp WebSocket...');
    wisp.routeRequest(req, socket, head);
  } 
  // Destroy any other upgrade requests
  else {
    socket.destroy();
  }
});


const PORT = 8000;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Master user: ${MASTER_USER} / ${MASTER_PASS}`);
    try {
    console.log("Starting ProxyBotAPI...");
    await proxyBot.createBot();
    console.log("ProxyBotAPI started and connected to Discord.");
    // The bot's `ready` event will trigger the first automated update.
  } catch(e) {
    console.error("FATAL: Could not start ProxyBotAPI.", e);
  }
});
