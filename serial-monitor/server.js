const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SerialPort } = require('serialport');
const fs = require('fs-extra');
const Path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CONFIG_PATH = Path.join(__dirname, 'config.json');
const LOGS_DIR = Path.join(__dirname, 'logs');
fs.ensureDirSync(LOGS_DIR);

let config = { ports: [], layout: [] };
if (fs.existsSync(CONFIG_PATH)) config = fs.readJsonSync(CONFIG_PATH);

const ports = new Map();
app.use(express.static(Path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.emit('config', config);
  const listPorts = async () => socket.emit('ports-list', await SerialPort.list());
  socket.on('list-ports', listPorts);
  listPorts();

  socket.on('open-port', ({ path: p, baudRate }) => {
    if (ports.has(p)) return;
    const port = new SerialPort({ path: p, baudRate });
    const logFile = Path.join(LOGS_DIR, `${p.replace(/[\\/:]/g,'_')}.log`);
    port.on('data', d => {
      const s = d.toString();
      io.emit('port-data', { path: p, data: s });
      fs.appendFileSync(logFile, s);
    });
    port.on('error', e => io.emit('port-error', { path: p, error: e.message }));
    ports.set(p, port);
  });

  socket.on('write-port', ({ path: p, data }) => {
    if (ports.has(p)) {
      ports.get(p).write(data);
    } else {
      io.emit('port-error', { path: p, error: 'Write failed: port not open' });
    }
  });

  socket.on('close-port', ({ path: p }) => {
    if (!ports.has(p)) return;
    ports.get(p).close();
    ports.delete(p);
  });

  socket.on('save-config', c => {
    config = c;
    fs.writeJsonSync(CONFIG_PATH, config, { spaces: 2 });
    socket.emit('config-saved', config);
  });

  socket.on('load-config', () => {
    if (fs.existsSync(CONFIG_PATH)) {
      config = fs.readJsonSync(CONFIG_PATH);
      socket.emit('config', config);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`OpenLab on ${PORT}`));