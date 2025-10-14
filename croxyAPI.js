import https from "https";
const agent = new https.Agent({ rejectUnauthorized: false });
import axios from "axios";
import * as cheerio from 'cheerio';
import { pipeline } from "stream/promises";
import zlib from "zlib";
import dgram from "dgram";
import { URL } from "url";

const geoCache = new Map();
const croxyProxyInstances = [
  "https://www.croxyproxy.rocks",
  "https://www.croxyproxy.com",
  "https://cdn.blockaway.net",
  "https://cdn.youtubeunblocked.live",
];

const PROXY_QUERY_PARAM = "__cpo";

/* -----------------------------
   Cookie helpers (work with raw header strings)
   ----------------------------- */
function parseCookieHeader(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(/;\s*/).forEach((part) => {
    const [k, ...rest] = part.split("=");
    if (k) cookies[k] = `${k}=${rest.join("=")}`;
  });
  return cookies;
}
function setCookieInHeader(header, key, value) {
  const cookies = parseCookieHeader(header);
  cookies[key] = `${key}=${value}`;
  return Object.values(cookies)
    .map((c) => (c.split("=")[1] ? c : ""))
    .filter(Boolean)
    .join("; ");
}
function deleteCookieFromHeader(header, key) {
  const cookies = parseCookieHeader(header);
  delete cookies[key];
  return Object.values(cookies)
    .map((c) => (c.split("=")[1] ? c : ""))
    .filter(Boolean)
    .join("; ");
}

/* -----------------------------
   Geo lookup (with cache)
   ----------------------------- */
async function geoLocate(ip = "") {
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const url = `https://data.leadboxer.com/api/ip-lookup?ip=${encodeURIComponent(ip)}`;
    const response = await axios.get(url, {
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "accept-language": "en-US,en;q=0.9",
        dnt: "1",
        origin: "https://www.opentracker.net",
        referer: "https://www.opentracker.net/feature/ip-tracker/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "x-api-key": "ec2d7a4d-b65f-4834-99c5-8f0670f1f04f",
      },
      timeout: 5000,
    });
    geoCache.set(ip, response.data);
    return response.data;
  } catch (error) {
    return { error: error.message || "Failed to fetch IP location." };
  }
}

/* -----------------------------
   Decoding helpers
   ----------------------------- */
function base64DecodeUtf8(str) {
  return Buffer.from(str, "base64").toString("utf-8");
}
function hexDecode(hexStr) {
  if (!hexStr) return "";
  return hexStr
    .match(/.{1,2}/g)
    .map((h) => String.fromCharCode(parseInt(h, 16)))
    .join("");
}
function decodeServerList(encodedJsonStr) {
  const jsonStr = encodedJsonStr.replace(/&quot;/g, '"');
  try {
    return JSON.parse(jsonStr).map((encoded) => {
      const base64Decoded = base64DecodeUtf8(encoded);
      return JSON.parse(hexDecode(base64Decoded)).url;
    });
  } catch (err) {
    console.error("Invalid encoded server list:", err && err.message);
    return [];
  }
}

/* -----------------------------
   Utils for IP range selection
   ----------------------------- */
function ipv4To16Key(ip) {
  if (!ip) return null;
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!m) return null;
  return `${m[1]}.${m[2]}`;
}

function getHostnameFromUrl(urlStr) {
  try {
    return new URL(urlStr).hostname;
  } catch (e) {
    return null;
  }
}

/* -----------------------------
   Fetch info for a small set of selected entries (ONLY these)
   This performs the heavier GET + geoLocate per host origin.
   entries: [{ serverUrl, csrfFromProxy }]
   ----------------------------- */
async function fetchInfoForEntries(entries, originalUrl) {
  // gather unique host origins so we only request each host once
  const hostMap = new Map(); // hostOrigin -> { geo, cookieValue }
  const hostOrigins = [...new Set(entries.map((e) => {
  return new URL(e.cpiUrl);
}))];

  await Promise.all(
    hostOrigins.map(async (hostUrl) => {
      const hostOrigin = hostUrl.origin;
      try {
        const host = new URL(hostOrigin);
        // small timeout on both geoLocate and GET
        const geo = await geoLocate(host.hostname); // geoLocate has its own timeout
        const res = await axios.get(hostUrl.href, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
          },
          validateStatus: null,
          timeout: 5000,
          httpsAgent: agent,
        });
        const cookies = res.headers["set-cookie"] || [];
        let cookieValue = null;
        for (const cookie of cookies) {
          const match = cookie.match(/__cpc=([^;]+)/);
          if (match) {
            cookieValue = match[1];
            break;
          }
        }

        hostMap.set(host.hostname, { geo, cookieValue, proxyHost: hostOrigin });
      } catch (err) {
        // Failure fetching host: store the error in geo so caller knows
        const hostname = (() => {
          try {
            return new URL(hostOrigin).hostname;
          } catch (e) {
            return hostOrigin;
          }
        })();
        hostMap.set(hostname, {
          geo: { error: err && err.message ? err.message : String(err) },
          cookieValue: null,
          proxyHost: hostOrigin,
        });
      }
    })
  );

  // Map back to entry-level results
  return entries.map((entry) => {
    const parsed = new URL(entry.serverUrl);
    const hostEntry = hostMap.get(parsed.hostname) || { geo: {}, cookieValue: null, proxyHost: parsed.origin };
    const cpiUrl = entry.cpiUrl;

    return {
      serverUrl: entry.serverUrl,
      cpiUrl,
      csrf: hostEntry.cookieValue,
      proxyHost: parsed.origin,
      ...(hostEntry.geo || {}),
    };
  });
}

/* -----------------------------
   Helper: resolve IPv4 with timeout
   ----------------------------- */
async function resolve4WithTimeout(hostname, timeoutMs = 2000) {
  const server = { address: "8.8.8.8", port: 53 }; // Google DNS
  const socket = dgram.createSocket("udp4");

  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 0xffff);
    const parts = hostname.split(".");
    const query = Buffer.alloc(12 + parts.reduce((a, p) => a + p.length + 1, 1) + 4);

    // DNS header
    query.writeUInt16BE(id, 0);      // ID
    query.writeUInt16BE(0x0100, 2);  // Flags: standard query
    query.writeUInt16BE(1, 4);       // QDCOUNT = 1
    query.writeUInt16BE(0, 6);       // ANCOUNT = 0
    query.writeUInt16BE(0, 8);       // NSCOUNT = 0
    query.writeUInt16BE(0, 10);      // ARCOUNT = 0

    // Write QNAME
    let offset = 12;
    for (const label of parts) {
      query.writeUInt8(label.length, offset++);
      query.write(label, offset);
      offset += label.length;
    }
    query.writeUInt8(0, offset++);   // Terminate QNAME
    query.writeUInt16BE(1, offset);  // QTYPE = A
    offset += 2;
    query.writeUInt16BE(1, offset);  // QCLASS = IN

    const timer = setTimeout(() => {
      socket.close();
      resolve(null);
    }, timeoutMs);

    socket.on("message", (msg) => {
      clearTimeout(timer);
      socket.close();

      const answerCount = msg.readUInt16BE(6);
      if (answerCount === 0) return resolve(null);

      // Skip question section
      let pos = 12;
      while (msg[pos] !== 0) pos += msg[pos] + 1;
      pos += 5; // null + QTYPE + QCLASS

      const addrs = [];
      for (let i = 0; i < answerCount; i++) {
        // Skip name pointer (2 bytes) + type + class + ttl
        pos += 10;
        const rdlength = msg.readUInt16BE(pos);
        pos += 2;
        if (rdlength === 4) {
          addrs.push(
            [...msg.slice(pos, pos + 4)].join(".")
          );
        }
        pos += rdlength;
      }

      resolve(addrs.length ? addrs : null);
    });

    socket.send(query, 0, query.length, server.port, server.address);
  });
}

/* -----------------------------
   grabIPs (updated):
   - decode candidate lists from each proxy (attach csrfFromProxy to each server)
   - dedupe candidates
   - iterate candidates and perform DNS resolves only until we have 4 entries from distinct /16 ranges
   - fill remaining slots if needed
   - call fetchInfoForEntries on *only* the selected entries
   ----------------------------- */
async function grabIPs(urlParam) {
  // Step 1: query each croxy proxy to get encoded lists (same as before)
  const attempts = await Promise.all(
    croxyProxyInstances.map(async (proxy) => {
      try {
        const getRes = await axios.get(proxy, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
          },
          validateStatus: null,
          timeout: 7000,
        });
        const html1 = getRes.data;
        if (!html1 || typeof html1 !== "string") {
          throw new Error(`Invalid HTML on GET ${proxy} (not a string)`);
        }
        const $1 = cheerio.load(html1);
        const csrf = $1('input[name="csrf"]').val();
        if (!csrf) {
          const snippet = html1.slice(0, 2000);
          throw new Error(`No CSRF token found on ${proxy}. HTML snippet:\n${snippet}`);
        }

        const postRes = await axios.post(
          proxy + "/servers",
          new URLSearchParams({ url: urlParam, csrf }),
          {
            headers: {
              referer: proxy + "/",
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
              "content-type": "application/x-www-form-urlencoded",
            },
            validateStatus: null,
            timeout: 7000,
          }
        );

        const postStatus = postRes.status;
        const html2 = postRes.data;

        if (postStatus >= 400) {
          const respSnippet =
            typeof html2 === "string" ? html2.slice(0, 2000) : JSON.stringify(html2).slice(0, 2000);
          throw new Error(`POST ${proxy}/servers returned ${postStatus}. Response snippet:\n${respSnippet}`);
        }

        const $2 = cheerio.load(html2 || "");
        const encoded = $2("#serverSelectorScript").attr("data-ss");

        if (!encoded) {
          const snippet = (typeof html2 === "string" ? html2 : JSON.stringify(html2)).slice(0, 2000);
          throw new Error(`No #serverSelectorScript[data-ss] found on ${proxy}. Response snippet:\n${snippet}`);
        }

        return { ok: true, proxy, encoded, csrf };
      } catch (err) {
        return { ok: false, proxy, error: (err && err.message) || String(err) };
      }
    })
  );

  const successes = attempts.filter((a) => a.ok);
  const failures = attempts.filter((a) => !a.ok);

  if (successes.length === 0) {
    const combined = failures.map((f) => `Proxy: ${f.proxy}\n${f.error}`).join("\n\n---\n\n");
    throw new Error(`Error fetching servers: all proxies failed.\n\n${combined}`);
  }
  if (failures.length > 0) {
    console.warn("Some proxies failed while fetching server lists:");
    failures.forEach((f) => {
      console.warn(`--- ${f.proxy} ---\n${f.error}\n`);
    });
  }

  // Step 2: decode all encoded lists and attach the csrfFromProxy to each server entry
  const candidateEntries = [];
  for (const s of successes) {
    try {
      const urls = decodeServerList(s.encoded || "[]");
      for (const u of urls) {
        candidateEntries.push({ serverUrl: u, csrfFromProxy: s.csrf, cpiUrl: `${new URL(u).origin}/__cpi.php?s=${encodeURIComponent(s.csrf)}&r=${encodeURIComponent(Buffer.from(urlParam).toString("base64"))}&__cpo=1`});
      }
    } catch (e) {
      // ignore decode failures for a single proxy, we already warned above
    }
  }

  // Step 3: dedupe candidates by serverUrl (preserve first seen csrfFromProxy)
  const seen = new Set();
  const dedupedCandidates = [];
  for (const c of candidateEntries) {
    if (!seen.has(c.serverUrl)) {
      seen.add(c.serverUrl);
      dedupedCandidates.push(c);
    }
  }

  // Step 4: iterate candidates and resolve IPv4 until we have 4 entries with distinct /16 ranges
  const LIMIT = 4;
  const rangeSeen = new Set();
  const selected = [];
  const leftovers = [];

  for (const entry of dedupedCandidates) {
    if (selected.length >= LIMIT) break;
    const hostname = getHostnameFromUrl(entry.serverUrl);
    if (!hostname) {
      leftovers.push(entry);
      continue;
    }

    // If hostname is already a literal IPv4, parse quickly
    let ips = null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      ips = [hostname];
    } else {
      // resolve but with a small timeout
      ips = await resolve4WithTimeout(hostname, 1500); // 1.5s DNS timeout
    }

    const ip = ips && ips.length ? ips[0] : null;
    const rangeKey = ipv4To16Key(ip);

    if (rangeKey && !rangeSeen.has(rangeKey)) {
      rangeSeen.add(rangeKey);
      // store resolved ip if we have it (useful later)
      selected.push(Object.assign({}, entry, { _resolvedIp: ip }));
    } else {
      leftovers.push(Object.assign({}, entry, { _resolvedIp: ip }));
    }
  }

  // fill remaining slots from leftovers (no further DNS resolves)
  for (const e of leftovers) {
    if (selected.length >= LIMIT) break;
    // avoid adding duplicates
    if (!selected.find((s) => s.serverUrl === e.serverUrl)) selected.push(e);
  }

  // Now we only call the heavy fetchInfoForEntries for the selected subset
  const results = await fetchInfoForEntries(selected, urlParam);

  // Optionally, you may want to keep track of which ones we skipped; return only the selected results
  return results;
}

/* -----------------------------
   createProxyUrl
   ----------------------------- */
function createProxyUrl(targetUrl, proxyHost) {
  try {
    const url = new URL(targetUrl);
    if (["data:", "blob:", "mailto:"].includes(url.protocol)) {
      return targetUrl;
    }
    const encodedOrigin = Buffer.from(url.origin).toString("base64");
    const proxyUrl = new URL(proxyHost);
    proxyUrl.pathname = url.pathname;
    proxyUrl.search = url.search;
    proxyUrl.searchParams.set(PROXY_QUERY_PARAM, encodedOrigin.replace(/=+$/, ''));
    return proxyUrl.href;
  } catch (e) {
    console.warn(`Could not create proxy URL for: ${targetUrl}`);
    console.log(e.message);
    console.log(`targetUrl: ${targetUrl}, proxyHost: ${proxyHost}`);
    return targetUrl;
  }
}

/* -----------------------------
   transformBody (HTML transforms)
   ----------------------------- */
   function cleanInjectedScript(html) {
  const $ = cheerio.load(html);

  // Find suspicious script in head
  const maliciousScript = $("head script[__cpp='1']").filter((_, el) => {
    return $(el).html().includes("this.URI");
  });

  if (maliciousScript.length) {
    // Remove the script itself
    maliciousScript.remove();

    // Remove inline style with __cpp="1"
    $("style[__cpp='1']").remove();

    // Remove modal container
    $("#__cpsModal").remove();

    // Remove window.__Cpn inline script if still exists anywhere else
    $("script").each((_, el) => {
      if ($(el).html().includes("window.__Cpn") || ($(el).attr("src") && $(el).attr("src").includes("/__cpa.cp.js") && $(el).attr("src").includes("__cpo=1"))) {
        $(el).remove();
      }
    });

    // Insert clean external JS reference instead
    $("head").prepend('<script src="/middleware.js"></script>');

    return $.html();
  }

  // If nothing matched, return original
  return html;
}
function transformBody(req, ip, body, contentType) {
  if (contentType.includes("html")) {
    body = cleanInjectedScript(body);
  }
  return body.replace(ip, req.get("host"));
}

/* -----------------------------
   proxyUrl - same as before (unchanged)
   ----------------------------- */
async function proxyUrl(req, res, url, ip, csrf) {
  try {
    if(url.startsWith(`${req.protocol}://${req.get('host')}/check?url=`)) return res.redirect(url);
    const requestHeaders = { ...(req.headers || {}) };
    requestHeaders.host = ip;
    requestHeaders.origin = "https://" + ip;
    if (requestHeaders.referer) {
      try {
        requestHeaders.referer = new URL(requestHeaders.referer, requestHeaders.origin).href;
      } catch (e) {}
    }

    let cookieHeader = requestHeaders.cookie || "";
    if ((!cookieHeader || cookieHeader.trim() === "") && req.cookies && typeof req.cookies === "object") {
      cookieHeader = Object.entries(req.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    }

    cookieHeader = setCookieInHeader(cookieHeader, "__cpc", csrf);
    cookieHeader = setCookieInHeader(cookieHeader, "__cpcPopShown", 1);
    cookieHeader = deleteCookieFromHeader(cookieHeader, "proxyIP");
    cookieHeader = deleteCookieFromHeader(cookieHeader, "csrf");
    cookieHeader = deleteCookieFromHeader(cookieHeader, "shouldProxy");
    cookieHeader = deleteCookieFromHeader(cookieHeader, "previousOrigin");
    cookieHeader = deleteCookieFromHeader(cookieHeader, "proxy_access");

    requestHeaders.Cookie = cookieHeader;
    delete requestHeaders.cookie;
    delete requestHeaders.cookies;
    delete requestHeaders["content-length"];

    const bodyBuffer = await new Promise((resolve) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", () => resolve(undefined));
      } else {
        resolve(undefined);
      }
    });
    const finalUrl = createProxyUrl(url, "https://" + ip);
    const remoteRes = await axios({
      method: req.method,
      url: finalUrl,
      headers: requestHeaders,
      data: bodyBuffer,
      validateStatus: () => true,
      responseType: "stream",
      maxRedirects: 0,
      httpsAgent: agent,
    });

    if (remoteRes.headers.location) {
      try {
        const originalLocation = new URL(remoteRes.headers.location, finalUrl);
        originalLocation.host = req.get("host");
        remoteRes.headers.location = originalLocation.toString();
      } catch (e) {}
    }
if (remoteRes.headers["set-cookie"]) {
  const host = req.hostname;
  remoteRes.headers["set-cookie"] = remoteRes.headers["set-cookie"].map(cookie => {
    // 1. Rename cookie key if it's "__cpc"
    cookie = cookie.replace(/^__cpc=/, "csrf=");

    // 2. Fix domain to current host
    if (/Domain=/i.test(cookie)) {
      cookie = cookie.replace(/Domain=[^;]+/i, `Domain=${host}`);
    } else {
      cookie += `; Domain=${host}`;
    }

    return cookie;
  });
}

    Object.entries(remoteRes.headers).forEach(([key, value]) => {
      if (key.toLowerCase() === "transfer-encoding") return;
      if (key.toLowerCase() === "content-length") return;
      res.setHeader(key, value);
    });

    res.status(remoteRes.status);

    const contentType = (remoteRes.headers["content-type"] || "").toLowerCase();
    const isBinary =
      contentType.startsWith("image/") ||
      contentType.startsWith("video/") ||
      contentType.startsWith("audio/") ||
      contentType === "application/octet-stream" ||
      contentType.includes("pdf") ||
      contentType.includes("zip");

    if (isBinary) {
      await pipeline(remoteRes.data, res);
      return;
    }

    const chunks = [];
    for await (const chunk of remoteRes.data) {
      chunks.push(chunk);
    }

    let body = Buffer.concat(chunks);
    const encoding = (remoteRes.headers["content-encoding"] || "").toLowerCase();

    try {
      if (encoding === "gzip") body = zlib.gunzipSync(body);
      else if (encoding === "deflate") body = zlib.inflateSync(body);
    } catch (e) {
      console.warn("Decompression failed:", e && e.message);
    }

    let bodyStr = body.toString("utf-8");
    bodyStr = transformBody(req, ip, bodyStr, contentType);

    let outBuffer = Buffer.from(bodyStr, "utf-8");
    if (encoding === "gzip") {
      outBuffer = zlib.gzipSync(outBuffer);
      res.setHeader("Content-Encoding", "gzip");
    } else if (encoding === "deflate") {
      outBuffer = zlib.deflateSync(outBuffer);
      res.setHeader("Content-Encoding", "deflate");
    } else {
      res.removeHeader("Content-Encoding");
    }

    res.setHeader("Content-Length", Buffer.byteLength(outBuffer));
    return res.send(outBuffer);
  } catch (err) {
    console.error("Proxy error:", err && err.message ? err.message : err);
    if (err && err.config && err.response) {
      const text = `Proxy upstream error: ${err.response.status} ${err.response.statusText}`;
      return res.status(502).send(text);
    }
    return res.status(500).send("Proxy error");
  }
}
async function handleWebSocketProxy(req, socket, head, proxy) {
  try {
    const { pathname, search } = new URL(req.url, `http://${req.headers.host}`);

    // Only handle WebSocket proxy endpoint
    if (pathname !== "/__cpw.php") return socket.destroy();

    // Check cookies
    const cookies = req.headers.cookie
      ? Object.fromEntries(req.headers.cookie.split("; ").map(c => c.split("=")))
      : {};

    const shouldProxy = cookies.shouldProxy === "true";
    if (!shouldProxy) return socket.destroy();

    let proxyIP = cookies.proxyIP;
    let csrf = cookies.csrf;

    // Dynamically grab a new proxy if missing
    if (!proxyIP || !csrf) {
      const croxyData = await grabIPs(`https://${req.headers.host}${pathname}`);
      const randProxy = croxyData[Math.floor(croxyData.length * Math.random())];

      proxyIP = new URL(randProxy.proxyHost).hostname;
      csrf = randProxy.csrf;

      // Send Set-Cookie headers (through socket response handshake)
      // Since WebSocket doesn’t support normal res.cookie, manually inject in upgrade response
      const cookieHeaders = [
        `Set-Cookie: proxyIP=${proxyIP}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        `Set-Cookie: csrf=${csrf}; Path=/; HttpOnly; Secure; SameSite=Lax`
      ].join("\r\n");

      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        cookieHeaders + "\r\n\r\n"
      );
    }

    // Build ws:// target using IP
    const protocol = req.headers.origin?.startsWith("https://") ? "wss://" : "ws://";
    const target = `${protocol}${proxyIP}${pathname}${search || ""}`;

    console.log(`Proxying WebSocket → ${target}`);
    const requestHeaders = { ...(req.headers || {}) };
    requestHeaders.host = proxyIP;
    requestHeaders.origin = "https://" + proxyIP;
    if (requestHeaders.referer) {
      try {
        requestHeaders.referer = new URL(requestHeaders.referer, requestHeaders.origin).href;
      } catch (e) {}
    }

    let cookieHeader = requestHeaders.cookie || "";
    if ((!cookieHeader || cookieHeader.trim() === "") && req.cookies && typeof req.cookies === "object") {
      cookieHeader = Object.entries(req.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    }

    cookieHeader = setCookieInHeader(cookieHeader, "__cpc", csrf);
    cookieHeader = setCookieInHeader(cookieHeader, "__cpcPopShown", 1);
    cookieHeader = deleteCookieFromHeader(cookieHeader, "proxyIP");
    cookieHeader = deleteCookieFromHeader(cookieHeader, "csrf");
    cookieHeader = deleteCookieFromHeader(cookieHeader, "shouldProxy");
    cookieHeader = deleteCookieFromHeader(cookieHeader, "previousOrigin");
    cookieHeader = deleteCookieFromHeader(cookieHeader, "proxy_access");

    requestHeaders.Cookie = cookieHeader;
    delete requestHeaders.cookie;
    delete requestHeaders.cookies;
    delete requestHeaders["content-length"];
    console.log(requestHeaders);
    proxy.ws(req, socket, head, {
      target,
      changeOrigin: true,
      secure: false,
      headers: requestHeaders
    });

  } catch (err) {
    console.error("WebSocket Proxy Error:", err.message);
    socket.destroy();
  }
}


/* -----------------------------
   decode helper export
   ----------------------------- */
const decode = (str) => Buffer.from(str, "base64").toString("utf-8");

export default { grabIPs, proxyUrl, createProxyUrl, decode, handleWebSocketProxy};
