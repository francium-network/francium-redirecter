// index.js
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";
import wisp from "wisp-server-node";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";

// Import our proprietary encoder/decoder
import { encode, decode } from "./encode-decode.js";

// --- CONFIGURATION ---
// These master credentials unlock the hidden proxy mode
const MASTER_USER = process.env.MASTER_USER || "uv-master";
const MASTER_PASS = process.env.MASTER_PASS || "enable-proxy-mode";
const COOKIE_NAME = "proxy_access";

// Since we are using ES Modules, define __dirname and paths
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicPath = join(__dirname, "public");

// Get the path to the Ultraviolet frontend static files
import { publicPath as proxyPublicPath } from "ultraviolet-static"; 
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

// These paths are protected and only accessible with the cookie
const protectedProxyPaths = ["/uv/", "/epoxy/", "/baremux/"];

const fastify = Fastify({
  serverFactory: (handler) => {
    return createServer()
      .on("request", handler) // Simpler request handling
      .on("upgrade", (req, socket, head) => {
        // --- PROTECT WISP WEBSOCKET ---
        const cookies = req.headers.cookie || "";
        if (!cookies.includes(`${COOKIE_NAME}=true`)) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        if (req.url.endsWith("/wisp/")) {
          wisp.routeRequest(req, socket, head);
        } else {
          socket.end();
        }
      });
  },
});

// Register cookie plugin
await fastify.register(fastifyCookie);

// --- HOOK TO PROTECT PROXY ASSETS ---
// This hook runs on every request and checks for the cookie
fastify.addHook("onRequest", async (req, res) => {
  const hasAccess = req.cookies[COOKIE_NAME] === "true";
  const isProxyPath = protectedProxyPaths.some(path => req.url.startsWith(path));

  if (isProxyPath && !hasAccess) {
    res.code(404).sendFile("404.html", publicPath);
  }
});

// Serve the public generator UI files
fastify.register(fastifyStatic, { root: publicPath, prefix: "/" });

// API Endpoint to encode a URL with its own credentials
fastify.post("/api/encode", (req, res) => {
  const { url, username, password } = req.body;
  if (!url || !username || !password) {
    return res.code(400).send({ message: "URL, username, and password are required" });
  }

  // Encode the payload containing all three values
  const encodedData = encode({ url, username, password });
  if (!encodedData) {
    return res.code(500).send({ message: "Failed to encode data" });
  }
  res.send({ data: encodedData });
});

// --- DYNAMIC ROUTE FOR PROTECTED LINKS ---
fastify.get("/r/:data", (req, res) => {
  const { data } = req.params;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return res.header("WWW-Authenticate", 'Basic realm="Secure Area"').code(401).send("Authentication required.");
  }
  
  const userCreds = Buffer.from(authHeader.substring(6), "base64").toString("utf-8");
  const [user, pass] = userCreds.split(":");

  // SCENARIO 1: User entered MASTER credentials to unlock proxy mode
  if (user === MASTER_USER && pass === MASTER_PASS) {
    res.setCookie(COOKIE_NAME, "true", {
      path: "/",
      httpOnly: true, // More secure
      maxAge: 86400,  // Cookie lasts for 1 day
    });
    // Redirect to root, where the server will now serve the proxy UI
    return res.redirect("/");
  }

  // SCENARIO 2: User entered link-specific credentials
  const linkPayload = decode(data);
  if (!linkPayload || !linkPayload.url || !linkPayload.username || !linkPayload.password) {
    return res.code(400).send("Invalid or corrupted link data.");
  }

  if (user === linkPayload.username && pass === linkPayload.password) {
    // Credentials match, redirect to the target URL
    return res.redirect(302, linkPayload.url);
  }

  // SCENARIO 3: Credentials are wrong
  return res.header("WWW-Authenticate", 'Basic realm="Secure Area"').code(401).send("Invalid credentials.");
});


// --- CONDITIONAL ROUTE FOR THE ROOT PAGE ---
// This route decides whether to show the generator UI or the proxy UI
fastify.get("/", (req, res) => {
  if (req.cookies[COOKIE_NAME] === "true") {
    // If cookie exists, serve the Ultraviolet proxy's main page
    res.sendFile("index.html", proxyPublicPath);
  } else {
    // Otherwise, serve the public link generator page
    res.sendFile("index.html", publicPath);
  }
});

// These are the static assets for the proxy, which are protected by the hook
fastify.register(fastifyStatic, { root: uvPath, prefix: "/uv/", decorateReply: false });
fastify.register(fastifyStatic, { root: epoxyPath, prefix: "/epoxy/", decorateReply: false });
fastify.register(fastifyStatic, { root: baremuxPath, prefix: "/baremux/", decorateReply: false });

// Server startup and shutdown logic
fastify.server.on("listening", () => {
  const address = fastify.server.address();
  console.log("Server is running!");
  console.log(`Master User: ${MASTER_USER} (use this to unlock proxy mode)`);
  console.log("Listening on:");
  console.log(`\thttp://localhost:${address.port}`);
});

process.on("SIGINT", () => fastify.close().then(() => process.exit(0)));
process.on("SIGTERM", () => fastify.close().then(() => process.exit(0)));

const port = parseInt(process.env.PORT || "") || 8080;
fastify.listen({ port, host: "0.0.0.0" });
