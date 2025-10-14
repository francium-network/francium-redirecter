// index.js
import dotenv from "dotenv";
dotenv.config();
import express from 'express';
import axios from "axios";
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import cookieParser from 'cookie-parser';
import pkg from 'http-proxy';
const { createProxyServer } = pkg;
const proxy = createProxyServer({ ws: true, changeOrigin: true });
import basicAuth from 'basic-auth';
import { WebSocketServer } from 'ws';
import BotAPI from './bot.js';
import proxyAPI from './proxyAPI.js';
import croxyAPI from "./croxyAPI.js";
const { grabIPs, proxyUrl, handleWebSocketProxy } = croxyAPI;
// FIX: Import the 'cookie' package to parse cookies in the upgrade handler
import cookie from 'cookie';

// Proprietary encoder/decoder
import { encrypt, decode as decrypt} from './encode-decode.js';

// --- CONFIGURATION ---
const MASTER_USER = process.env.MASTER_USER || 'uv-master';
const MASTER_PASS = process.env.MASTER_PASS || 'enable-proxy-mode';
const COOKIE_NAME = 'proxy_access';
const PROXY_QUERY_PARAM = '__cpo';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicPath = join(__dirname, 'public');
const secretPath = join(__dirname, 'freeRobux');

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
};

const app = express();

// Parse cookies & JSON bodies
app.use(cookieParser());
app.use(express.json());

// FIX #1: Add a middleware that applies SharedWorker headers to all authenticated requests.
// This ensures that the main HTML page gets the correct headers, which is crucial.
app.use((req, res, next) => {
  const ip = req.headers["x-forwarded-for"] || "true";
  if (req.cookies[COOKIE_NAME] === encrypt(ip)) {
    // These headers are required for the SharedWorker to function.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }
  next();
});
app.use(async (req, res, next) => {
    const ip = req.headers["x-forwarded-for"] || "true";
    // If it's not a proxy request, serve static files (like your handler scripts) or 404
    if (((!req.query[PROXY_QUERY_PARAM]) && !req.cookies.previousOrigin) || !req.cookies.shouldProxy || req.query[PROXY_QUERY_PARAM] == "1" || req.cookies[COOKIE_NAME] !== encrypt(ip)) {
        return next();
    }
    const originForUrl = req.query[PROXY_QUERY_PARAM] ?? req.cookies.previousOrigin;
    const originUrl = Buffer.from(decodeURIComponent(originForUrl), "base64").toString("utf-8");
    const fullUrl = (()=>{const u=new URL(req.originalUrl, originUrl); u.searchParams.delete('__cpo'); return u.toString()})();
    if(req.cookies.proxyIP && req.cookies.csrf && req.cookies.shouldProxy){
        return await proxyUrl(req, res, fullUrl, req.cookies.proxyIP, req.cookies.csrf);
    } else if(req.cookies.shouldProxy){
        var croxyData = await grabIPs(fullUrl);
        const randProxy = croxyData[Math.floor(croxyData.length * Math.random())];
        res.cookie("csrf", randProxy.csrf, {
            maxAge: 3 * 60 * 60 * 1000, // 3 hours in milliseconds
            secure: true,   // if using HTTPS
            sameSite: "lax"
        });
        res.cookie("proxyIP", new URL(randProxy.proxyHost).hostname, {
            maxAge: 3 * 60 * 60 * 1000, // 3 hours in milliseconds
            secure: true,   // if using HTTPS
            sameSite: "lax"
        });
        return await proxyUrl(req, res, fullUrl, new URL(randProxy.proxyHost).hostname, randProxy.csrf);
    }
});
// Static file servers
const secretStatic = express.static(secretPath);
const publicStatic = express.static(publicPath);

// Serve correct frontend based on authentication
app.use('/', (req, res, next) => {
  const ip = req.headers["x-forwarded-for"] || "true";
  if (req.cookies[COOKIE_NAME] === encrypt(ip)) {
    return secretStatic(req, res, next);
  } else {
    return publicStatic(req, res, next);
  }
});

// API to encode a link
app.post('/api/encode', (req, res) => {
  const { url, username, password } = req.body;
  if (!url || !username || !password) {
    return res.status(400).json({ message: 'URL, username, and password required' });
  }
  const data = encrypt({ url, username, password });
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
    res.cookie(COOKIE_NAME, encrypt(ip), {
      path: '/', httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'strict'
    });
    return res.redirect('/');
  }

  // Otherwise, link-specific creds
  const payload = decrypt(data);
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
app.get('/check', async (req, res, next) => {
    const ip = req.headers["x-forwarded-for"] || "true";
  if (req.cookies[COOKIE_NAME] !== encrypt(ip)) {
    next();
  }
    const url = req.query.url;

    if (!url) {
        return res.status(400).send('false');
    }

    try {
        // Make a HEAD request first (faster, no body)
        const response = await axios.head(url, { timeout: 5000, validateStatus: () => true });

        // If HEAD fails (some servers block it), try GET
        if (response.status < 200 || response.status >= 400) {
            const fallbackResponse = await axios.get(url, { timeout: 5000, validateStatus: () => true });
            if (fallbackResponse.status >= 200 && fallbackResponse.status < 400) {
                return res.send('true');
            } else {
                return res.send('false');
            }
        }

        // HEAD succeeded and returned 2xx–3xx
        res.send('true');

    } catch (error) {
        console.error('Error checking URL:', error.message);
        res.send('false');
    }
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
  const isAuthenticated = cookies[COOKIE_NAME] === encrypt(ip);
  
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
  else {
    handleWebSocketProxy(req, socket, head, proxy)
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