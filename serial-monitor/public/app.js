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
const snapIndicator = document.getElementById('snapIndicator');

let config = { ports: [], positions: {} };
let autoScroll = {};
let errors = [];
let dragTarget = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let snapZones = {}; // Will hold snap regions

// Show/hide custom baud rate input
baudSelect.addEventListener('change', () => {
  baudCustom.style.display = baudSelect.value === 'custom' ? 'inline-block' : 'none';
});

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

// Calculate snapping regions
function calculateSnapZones() {
  const containerRect = terminals.getBoundingClientRect();
  const snapThreshold = 20; // px within which snapping happens
  
  // Basic snap zones for the container edges
  snapZones = {
    left: {
      x: containerRect.left,
      width: snapThreshold,
      y: containerRect.top,
      height: containerRect.height,
      action: (el) => { el.style.left = '0px'; }
    },
    right: {
      x: containerRect.right - snapThreshold,
      width: snapThreshold,
      y: containerRect.top,
      height: containerRect.height,
      action: (el) => { 
        // Snap to right edge minus the element width
        el.style.left = (containerRect.width - el.offsetWidth) + 'px';
      }
    },
    top: {
      x: containerRect.left,
      width: containerRect.width,
      y: containerRect.top,
      height: snapThreshold,
      action: (el) => { el.style.top = '0px'; }
    },
    bottom: {
      x: containerRect.left,
      width: containerRect.width,
      y: containerRect.bottom - snapThreshold,
      height: snapThreshold,
      action: (el) => { 
        // Snap to bottom edge minus the element height
        el.style.top = (containerRect.height - el.offsetHeight) + 'px'; 
      }
    },
    // Horizontal middle (full width)
    fullWidth: {
      x: containerRect.left + snapThreshold,
      width: containerRect.width - (snapThreshold * 2),
      y: containerRect.top,
      height: snapThreshold * 2,
      action: (el) => { 
        el.style.left = '0px';
        el.style.width = '100%';
        el.classList.add('split-h');
      }
    },
    // Half width left side
    leftHalf: {
      x: containerRect.left,
      width: snapThreshold * 2,
      y: containerRect.top + snapThreshold * 2,
      height: containerRect.height - (snapThreshold * 4),
      action: (el) => {
        el.style.left = '0px';
        el.style.width = '50%'; 
        el.classList.remove('split-h');
      }
    },
    // Half width right side
    rightHalf: {
      x: containerRect.right - (snapThreshold * 2),
      width: snapThreshold * 2,
      y: containerRect.top + snapThreshold * 2,
      height: containerRect.height - (snapThreshold * 4),
      action: (el) => {
        el.style.left = '50%';
        el.style.width = '50%';
        el.classList.remove('split-h');
      }
    }
  };

  // Add terminal-to-terminal snap zones
  const wrappers = Array.from(document.querySelectorAll('.terminal-wrapper'))
    .filter(w => !w.classList.contains('fullscreen'));
    
  wrappers.forEach(wrap => {
    if (wrap === dragTarget) return; // Skip the one being dragged
    
    const rect = wrap.getBoundingClientRect();
    const id = wrap.id;
    
    // Right edge of other terminals - snap to left side
    snapZones[`${id}-right`] = {
      x: rect.right,
      width: snapThreshold,
      y: rect.top,
      height: rect.height,
      action: (el) => {
        el.style.left = (rect.right - containerRect.left) + 'px';
      }
    };
    
    // Left edge of other terminals - snap to right side
    snapZones[`${id}-left`] = {
      x: rect.left - snapThreshold,
      width: snapThreshold,
      y: rect.top,
      height: rect.height,
      action: (el) => {
        el.style.left = (rect.left - containerRect.left - el.offsetWidth) + 'px';
      }
    };
    
    // Bottom edge - snap below
    snapZones[`${id}-bottom`] = {
      x: rect.left,
      width: rect.width,
      y: rect.bottom,
      height: snapThreshold,
      action: (el) => {
        el.style.top = (rect.bottom - containerRect.top) + 'px';
      }
    };
    
    // Top edge - snap above
    snapZones[`${id}-top`] = {
      x: rect.left,
      width: rect.width,
      y: rect.top - snapThreshold,
      height: snapThreshold,
      action: (el) => {
        el.style.top = (rect.top - containerRect.top - el.offsetHeight) + 'px';
      }
    };
  });
}

// Check if element is in a snap zone
function checkSnap(x, y, element) {
  calculateSnapZones();
  
  const elementRect = element.getBoundingClientRect();
  const elementCenterX = x + elementRect.width / 2;
  const elementCenterY = y + elementRect.height / 2;
  
  // Hide the indicator first
  snapIndicator.style.display = 'none';
  
  for (const zoneName in snapZones) {
    const zone = snapZones[zoneName];
    
    // Check if element center is within the snap zone
    if (
      elementCenterX >= zone.x && 
      elementCenterX <= zone.x + zone.width &&
      elementCenterY >= zone.y && 
      elementCenterY <= zone.y + zone.height
    ) {
      // Show indicator where it would snap
      snapIndicator.style.display = 'block';
      snapIndicator.style.left = zone.x + 'px';
      snapIndicator.style.top = zone.y + 'px';
      snapIndicator.style.width = zone.width + 'px';
      snapIndicator.style.height = zone.height + 'px';
      
      return zone;
    }
  }
  
  return null;
}

// Save positions to config
function savePositions() {
  config.positions = {};
  
  document.querySelectorAll('.terminal-wrapper').forEach(wrapper => {
    const id = wrapper.id;
    const path = id.replace(/^wrapper-/, '');
    
    config.positions[path] = {
      left: wrapper.style.left,
      top: wrapper.style.top,
      width: wrapper.style.width,
      height: wrapper.style.height,
      classes: Array.from(wrapper.classList)
        .filter(c => c !== 'terminal-wrapper')
    };
  });
  
  socket.emit('save-config', config);
}

// Apply saved positions
function applyPositions() {
  if (!config.positions) return;
  
  Object.entries(config.positions).forEach(([path, pos]) => {
    const wrapper = document.getElementById(`wrapper-${path}`);
    if (!wrapper) return;
    
    wrapper.style.left = pos.left || '0px';
    wrapper.style.top = pos.top || '0px';
    wrapper.style.width = pos.width || '48%';
    wrapper.style.height = pos.height || '400px';
    
    // Apply classes
    if (pos.classes) {
      pos.classes.forEach(cls => wrapper.classList.add(cls));
    }
  });
}

// Mouse event handlers for drag
function handleMouseDown(e) {
  // Only handle drag on title bar, not buttons
  if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
    return;
  }
  
  // Find the terminal wrapper
  dragTarget = e.target.closest('.terminal-wrapper');
  if (!dragTarget) return;
  
  // Don't drag if in fullscreen
  if (dragTarget.classList.contains('fullscreen')) return;
  
  // Calculate offset from the element's edges
  const rect = dragTarget.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;
  
  // Bring to front
  dragTarget.style.zIndex = '10';
  
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  
  e.preventDefault();
}

function handleMouseMove(e) {
  if (!dragTarget) return;
  
  const containerRect = terminals.getBoundingClientRect();  
  let newLeft = e.clientX - dragOffsetX - containerRect.left;
  let newTop = e.clientY - dragOffsetY - containerRect.top;
  
  // Boundary check
  newLeft = Math.max(0, Math.min(newLeft, containerRect.width - dragTarget.offsetWidth));
  newTop = Math.max(0, Math.min(newTop, containerRect.height - dragTarget.offsetHeight));
  
  // Check for snapping before applying the position
  const snapZone = checkSnap(newLeft, newTop, dragTarget);
  
  if (!snapZone) {
    // No snap zone found, just move to mouse position
    dragTarget.style.left = newLeft + 'px';
    dragTarget.style.top = newTop + 'px';
    
    // Remove any fullwidth/halfwidth classes when freely moved
    dragTarget.classList.remove('split-h');
  }
}

function handleMouseUp(e) {
  if (!dragTarget) return;
  
  // Check for snap and apply if found
  const containerRect = terminals.getBoundingClientRect();
  let newLeft = e.clientX - dragOffsetX - containerRect.left;
  let newTop = e.clientY - dragOffsetY - containerRect.top;
  
  const snapZone = checkSnap(newLeft, newTop, dragTarget);
  if (snapZone) {
    snapZone.action(dragTarget);
  }
  
  // Save new positions to config
  savePositions();
  
  // Reset drag state
  dragTarget.style.zIndex = '';
  dragTarget = null;
  
  // Hide snap indicator
  snapIndicator.style.display = 'none';
  
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
}

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
  
  // Apply saved positions
  setTimeout(applyPositions, 100);
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
  
  // Apply saved positions
  setTimeout(applyPositions, 100);
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
  
  // Set initial position (staggered for multiple windows)
  const existingCount = document.querySelectorAll('.terminal-wrapper').length;
  const offsetPx = existingCount * 20;
  wrap.style.left = offsetPx + 'px';
  wrap.style.top = offsetPx + 'px';
  
  // If already in config, use those positions
  if (config.positions && config.positions[path]) {
    const pos = config.positions[path];
    wrap.style.left = pos.left || '0px';
    wrap.style.top = pos.top || '0px';
    wrap.style.width = pos.width || '48%';
    wrap.style.height = pos.height || '400px';
    
    // Apply classes
    if (pos.classes) {
      pos.classes.forEach(cls => wrap.classList.add(cls));
    }
  } else {
    // Default size if no saved position
    wrap.style.width = '48%';
    wrap.style.height = '400px';
  }

  // Title bar
  const bar = document.createElement('div'); 
  bar.className = 'title-bar';
  // Make title bar handle mouse events for dragging
  bar.addEventListener('mousedown', handleMouseDown);
  
  const title = document.createElement('h3'); 
  title.textContent = path; 
  bar.appendChild(title);
  
  const btnGroup = document.createElement('div'); 
  btnGroup.className = 'button-group';

  // Layout controls
  [['⛶','fullscreen'],['⇔','split-h'],['⇕','split-v']].forEach(([icon, act]) => {
    const btn = document.createElement('button');
    btn.className = 'layout-btn';
    btn.textContent = icon;
    btn.onclick = () => {
      // Toggle layout class
      wrap.classList.toggle(act);
      
      // Special handling for fullscreen
      if (act === 'fullscreen') {
        if (wrap.classList.contains('fullscreen')) {
          // Save current position for when we exit fullscreen
          wrap.dataset.prevLeft = wrap.style.left;
          wrap.dataset.prevTop = wrap.style.top;
          wrap.dataset.prevWidth = wrap.style.width;
          wrap.dataset.prevHeight = wrap.style.height;
        } else {
          // Restore previous position
          wrap.style.left = wrap.dataset.prevLeft || '0px';
          wrap.style.top = wrap.dataset.prevTop || '0px';
          wrap.style.width = wrap.dataset.prevWidth || '48%';
          wrap.style.height = wrap.dataset.prevHeight || '400px';
        }
      }
      
      // Handle horizontal split special cases
      if (act === 'split-h' && wrap.classList.contains('split-h')) {
        wrap.style.left = '0px';
        wrap.style.width = '100%';
      } else if (act === 'split-h' && !wrap.classList.contains('split-h')) {
        wrap.style.width = '48%';
      }
      
      // Handle vertical split special cases
      if (act === 'split-v' && wrap.classList.contains('split-v')) {
        wrap.style.height = '80%';
      } else if (act === 'split-v' && !wrap.classList.contains('split-v')) {
        wrap.style.height = '400px';
      }
      
      // Save the new layout
      savePositions();
    };
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
    
    // Update config when a terminal is closed
    savePositions();
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
  
  // Save positions
  savePositions();
};

saveBtn.onclick = () => {
  // Build config based on currently open terminals
  const wrappers = Array.from(document.querySelectorAll('.terminal-wrapper'));
  config.ports = wrappers.map(wrap => ({
    path: wrap.id.replace(/^wrapper-/, ''),
    baudRate: parseInt(wrap.dataset.baud, 10)
  }));
  
  // Save the positions configuration
  savePositions();
  
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

// Listen for window resizing to recalculate snap zones
window.addEventListener('resize', calculateSnapZones);