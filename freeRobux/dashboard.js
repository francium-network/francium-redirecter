document.addEventListener('DOMContentLoaded', () => {
    const statusIndicator = document.getElementById('status-indicator');
    const cacheTableBody = document.getElementById('cache-table-body');
    
    // Form Elements
    const getProxiesForm = document.getElementById('get-proxies-form');
    const getTypeSelect = document.getElementById('get-type');
    const getFilterSelect = document.getElementById('get-filter');
    const getCountInput = document.getElementById('get-count');

    // Button Elements
    const refreshCacheBtn = document.getElementById('refresh-cache-btn');

    let ws;
    const FILTERS = ["lightspeed", "securly", "no-filter-all-links"];
    const TYPES = ["rammerhead", "rammerheadpremium", "void", "velera", "duckhtml", "emeraldandphantom", "astroid", "utopia", "plexile", "truffled", "shadow", "selenite", "szvy", "space"];

    function populateSelects() {
        TYPES.forEach(t => {
            getTypeSelect.innerHTML += `<option value="${t}">${t}</option>`;
        });
        
        FILTERS.forEach(f => {
            getFilterSelect.innerHTML += `<option value="${f}">${f}</option>`;
        });
    }

    function log(message, type = 'info') {
        // You can add a log area back to the HTML if you want to see these messages for debugging
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    function connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api-ws`;
        
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            statusIndicator.textContent = 'Connected';
            statusIndicator.className = 'status-connected';
            log('WebSocket connection established.');
            sendCommand('getCacheStatus');
        };

        ws.onclose = (event) => {
            statusIndicator.textContent = 'Disconnected';
            statusIndicator.className = 'status-disconnected';
            log(`WebSocket disconnected. Code: ${event.code}. Reconnecting in 5 seconds...`, 'warn');
            setTimeout(connect, 5000);
        };

        ws.onerror = (error) => {
            log('WebSocket error.', 'error');
            ws.close();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (e) {
                log('Received non-JSON message from server.', 'error');
            }
        };
    }
    
    function sendCommand(command, params = {}) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const payload = JSON.stringify({ command, params });
            ws.send(payload);
        } else {
            log('Cannot send command: WebSocket is not connected.', 'error');
        }
    }

    function handleServerMessage(msg) {
        if (msg.status === 'error') {
            alert(`Server Error on command '${msg.command}': ${msg.error}`);
            return;
        }

        switch (msg.command) {
            case 'getCacheStatus':
                updateCacheTable(msg.data);
                break;
            case 'getProxies':
                displayProxyResults(msg.data);
                break;
        }
    }

    function updateCacheTable(statusData) {
        cacheTableBody.innerHTML = '';
        if (!statusData) {
            cacheTableBody.innerHTML = '<tr><td colspan="5">No cache data received.</td></tr>';
            return;
        }
        
        for (const filter in statusData) {
            for (const type in statusData[filter]) {
                const entry = statusData[filter][type];
                const row = document.createElement('tr');
                
                const ageMs = Date.now() - entry.timestamp;
                const ageMinutes = Math.floor(ageMs / 60000);
                let ageClass = 'fresh';
                if (ageMinutes > 60) ageClass = 'old';
                else if (ageMinutes > 30) ageClass = 'stale';

                const ageText = entry.timestamp === 0 ? 'Never' : `${ageMinutes}m ago`;

                row.innerHTML = `
                    <td>${filter}</td>
                    <td>${type}</td>
                    <td>${entry.count}</td>
                    <td><span class="age ${ageClass}">${ageText}</span></td>
                    <td>${entry.isFetching ? '<span class="fetching">Fetching...</span>' : 'Idle'}</td>
                `;
                cacheTableBody.appendChild(row);
            }
        }
    }

    function displayProxyResults(result) {
        const { success, data, total, cached, timestamp } = result;
        const proxyList = data.join('\n');
        
        const message = `
Success: ${success}
Source: ${cached ? 'Cache' : 'Fresh Fetch'}
Retrieved: ${data.length} of ${total} available
Timestamp: ${new Date(timestamp).toLocaleString()}

Proxies:
-------------------
${proxyList}
        `;
        
        const blob = new Blob([message], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        URL.revokeObjectURL(url);
    }
    
    // Event Listeners
    refreshCacheBtn.addEventListener('click', () => sendCommand('getCacheStatus'));

    getProxiesForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendCommand('getProxies', {
            type: getTypeSelect.value,
            filter: getFilterSelect.value,
            count: parseInt(getCountInput.value, 10),
        });
    });

    // Initializations
    populateSelects();
    connect();
});