
const socket = io();
const listBtn = document.getElementById('listPorts');
const portsSelect = document.getElementById('ports');
const baudSelect = document.getElementById('baudRateSelect');
const baudCustom = document.getElementById('baudRateCustom');
const openBtn = document.getElementById('openPort');
const saveBtn = document.getElementById('saveConfig');
const loadBtn = document.getElementById('loadConfig');
const downloadConfigCheckbox = document.getElementById('downloadConfigCheckbox');
const configFileInput = document.getElementById('configFileInput');
const terminals = document.getElementById('terminals');
const errorBadge = document.getElementById('errorBadge');
const errorPanel = document.getElementById('errorPanel');

let config = { ports: [] };
let autoScroll = {};
let errors = [];

// Error display
function updateErrors() {
  if (!errors.length) {
    errorBadge.style.display = 'none';
    errorPanel.style.display = 'none';
  } else {
    errorBadge.style.display = 'inline-block';
    errorBadge.textContent = `Errors: ${errors.length}`;
    errorPanel.style.display = 'block';
    errorPanel.innerHTML = '';
    errors.forEach(err => {
      const div = document.createElement('div');
      div.textContent = err;
      errorPanel.appendChild(div);
    });
  }
}
errorBadge.onclick = () => { errors = []; updateErrors(); };

// Socket events
socket.on('connect', () => {
  socket.emit('load-config');
  socket.emit('list-ports');
});

socket.on('config', c => {
  config = c;
  clearAllTerminals();
  // Auto-reconnect saved ports
  (config.ports || []).forEach(({ path, baudRate }) => {
    openTerminal(path, baudRate);
    socket.emit('open-port', { path, baudRate });
  });
});

socket.on('ports-list', ps => {
  portsSelect.innerHTML = '';
  ps.forEach(p => {
    const o = document.createElement('option');
    o.value = o.text = p.path;
    portsSelect.appendChild(o);
  });
});

socket.on('port-data', ({ path, data }) => {
  const termDiv = document.getElementById(`term-${path}`);
  if (!termDiv) return;
  const clean = data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const inputLine = termDiv.querySelector('.term-input');
  inputLine.insertAdjacentText('beforebegin', clean);
  if (autoScroll[path]) termDiv.scrollTop = termDiv.scrollHeight;
});

socket.on('port-error', ({ path, error }) => {
  const msg = `Port ${path}: ${error}`;
  errors.push(msg);
  updateErrors();
});

socket.on('reconnect', () => {
  socket.emit('load-config');
  socket.emit('list-ports');
});

// After saving config, refresh terminals and reconnect hardware
socket.on('config-saved', c => {
  config = c;
  clearAllTerminals();
  (config.ports || []).forEach(({ path, baudRate }) => {
    openTerminal(path, baudRate);
    // hardware reopen
    socket.emit('open-port', { path, baudRate });
  });
});

// Clear terminals
function clearAllTerminals() {
  terminals.innerHTML = '';
}

// Create a terminal window
function openTerminal(path, baud) {
  if (document.getElementById(`wrapper-${path}`)) return;
  const wrap = document.createElement('div');
  wrap.id = `wrapper-${path}`;
  wrap.className = 'terminal-wrapper';
  wrap.dataset.baud = baud;

  // Title bar
  const bar = document.createElement('div'); bar.className = 'title-bar';
  const title = document.createElement('h3'); title.textContent = path; bar.appendChild(title);
  const btnGroup = document.createElement('div'); btnGroup.className = 'button-group';

  // Layout controls
  [['⛶','fullscreen'],['⇔','split-h'],['⇕','split-v']].forEach(([icon, act]) => {
    const btn = document.createElement('button');
    btn.className = 'layout-btn';
    btn.textContent = icon;
    btn.onclick = () => wrap.classList.toggle(act);
    btnGroup.appendChild(btn);
  });

  // Auto-scroll pin
  const pinBtn = document.createElement('button');
  pinBtn.className = 'layout-btn';
  pinBtn.textContent = '📌';
  autoScroll[path] = true;
  pinBtn.onclick = () => {
    autoScroll[path] = !autoScroll[path];
    pinBtn.style.opacity = autoScroll[path] ? '1' : '0.5';
  };
  btnGroup.appendChild(pinBtn);

  // Download log
  const dlBtn = document.createElement('button');
  dlBtn.className = 'download-btn';
  dlBtn.textContent = '💾';
  dlBtn.onclick = () => {
    const td = document.getElementById(`term-${path}`);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const hdr = `Port: ${path}\nBaud: ${baud}\nTime: ${ts}\n\n`;
    const blob = new Blob([hdr + td.innerText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `log_${path.replace(/[\\/:]/g,'_')}_${baud}_${ts}.txt`;
    a.click(); URL.revokeObjectURL(url);
  };
  btnGroup.appendChild(dlBtn);

  // Close
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = '✖';
  closeBtn.onclick = () => {
    socket.emit('close-port', { path });
    wrap.remove();
  };
  btnGroup.appendChild(closeBtn);

  bar.appendChild(btnGroup);
  wrap.appendChild(bar);

  // Terminal pane
  const termDiv = document.createElement('div');
  termDiv.id = `term-${path}`;
  termDiv.className = 'terminal';
  termDiv.tabIndex = 0;

  // Input line
  const inputLine = document.createElement('div');
  inputLine.className = 'term-input';
  inputLine.contentEditable = true;
  inputLine.onkeypress = e => {
    if (e.key === 'Enter') {
      const text = inputLine.innerText;
      socket.emit('write-port', { path, data: text + '\n' });
      inputLine.innerText = '';
      e.preventDefault();
    }
  };
  termDiv.appendChild(inputLine);
  wrap.appendChild(termDiv);
  terminals.appendChild(wrap);

  // Hardware open
  socket.emit('open-port', { path, baudRate: baud });
}

// Controls
listBtn.onclick = () => socket.emit('list-ports');
openBtn.onclick = () => {
  const path = portsSelect.value;
  const baud = baudSelect.value === 'custom'
    ? parseInt(baudCustom.value, 10) || 115200
    : parseInt(baudSelect.value, 10);
  // Open only this terminal window
  openTerminal(path, baud);
  // Persist this config so reload reconnects
  config.ports = Array.from(document.querySelectorAll('.terminal-wrapper')).map(wrap => ({
    path: wrap.id.replace(/^wrapper-/, ''),
    baudRate: parseInt(wrap.dataset.baud, 10)
  }));
  socket.emit('save-config', config);
};

saveBtn.onclick = () => {
  // Build config based on currently open terminals
  const wrappers = Array.from(document.querySelectorAll('.terminal-wrapper'));
  config.ports = wrappers.map(wrap => ({
    path: wrap.id.replace(/^wrapper-/, ''),
    baudRate: parseInt(wrap.dataset.baud, 10)
  }));
  // Overwrite server config with this exact list
  socket.emit('save-config', config);
  if (downloadConfigCheckbox.checked) {
    const dataStr = JSON.stringify(config, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `openlab-config_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click(); URL.revokeObjectURL(url);
  }
};

loadBtn.onclick = () => configFileInput.click();
configFileInput.onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const obj = JSON.parse(ev.target.result);
      config = obj;
      socket.emit('save-config', config);
    } catch (err) {
      alert('Invalid JSON config file');
    }
  };
  reader.readAsText(file);
};
