const dfuButton = document.querySelector('#dfuButton');
const flashButton = document.querySelector('#flashButton');
const dfuStatus = document.querySelector('#dfuStatus');
const usbDeviceSelect = document.querySelector('#usbDeviceSelect');
const refreshUsb = document.querySelector('#refreshUsb');
const firmwareFile = document.querySelector('#firmwareFile');
const firmwareName = document.querySelector('#firmwareName');
const serialButton = document.querySelector('#serialButton');
const serialStatus = document.querySelector('#serialStatus');
const serialDeviceSelect = document.querySelector('#serialDeviceSelect');
const refreshSerial = document.querySelector('#refreshSerial');
const monitorPanel = document.querySelector('#monitorPanel');
const monitorState = document.querySelector('#monitorState');
const startMonitor = document.querySelector('#startMonitor');
const stopMonitor = document.querySelector('#stopMonitor');
const receiveFormat = document.querySelector('#receiveFormat');
const serialLog = document.querySelector('#serialLog');
const clearLog = document.querySelector('#clearLog');
const sendForm = document.querySelector('#sendForm');
const sendFormat = document.querySelector('#sendFormat');
const lineEnding = document.querySelector('#lineEnding');
const sendInput = document.querySelector('#sendInput');
const baudRate = document.querySelector('#baudRate');

let usbDevices = [];
let serialPorts = [];
let selectedUsbDevice;
let selectedFirmware;
let serialPort;
let serialWriter;
let serialReader;
let monitorRunning = false;
let receivedChunks = [];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function browserMessage(apiName) {
  return `${apiName} 需要在支持该 API 的 Chromium 浏览器中，并通过 HTTPS 或 localhost 打开。`;
}

function deviceName(device) {
  return device.productName || `USB ${device.vendorId.toString(16).padStart(4, '0')}:${device.productId.toString(16).padStart(4, '0')}`;
}

function portName(port) {
  const info = port.getInfo();
  const vendor = info.usbVendorId?.toString(16).padStart(4, '0');
  const product = info.usbProductId?.toString(16).padStart(4, '0');
  return vendor && product ? `CDC ${vendor}:${product}` : '系统串口';
}

function updateFlashButton() {
  flashButton.disabled = !(selectedUsbDevice && selectedFirmware);
}

function refreshLog() {
  if (!receivedChunks.length) {
    serialLog.textContent = '等待串口数据…';
    return;
  }
  serialLog.textContent = receivedChunks.map(({ time, direction, bytes, message }) => {
    if (message) return `[${time}] ${message}`;
    const rendered = receiveFormat.value === 'hex'
      ? Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
      : new TextDecoder().decode(bytes);
    return `[${time}] ${direction} ${rendered}`;
  }).join('\n');
  serialLog.scrollTop = serialLog.scrollHeight;
}

function addMessage(message) {
  receivedChunks.push({
    time: new Date().toLocaleTimeString(),
    message,
  });
  refreshLog();
}

function addBytes(direction, bytes) {
  receivedChunks.push({
    time: new Date().toLocaleTimeString(),
    direction,
    bytes: new Uint8Array(bytes),
  });
  refreshLog();
}

async function refreshUsbDevices() {
  if (!('usb' in navigator)) {
    usbDeviceSelect.innerHTML = '<option value="">当前浏览器不支持 WebUSB</option>';
    return;
  }
  usbDevices = await navigator.usb.getDevices();
  usbDeviceSelect.innerHTML = '';
  if (!usbDevices.length) {
    usbDeviceSelect.add(new Option('尚未发现已授权的 USB 设备', ''));
    selectedUsbDevice = undefined;
    updateFlashButton();
    return;
  }
  usbDevices.forEach((device, index) => {
    usbDeviceSelect.add(new Option(`${deviceName(device)} · ${device.serialNumber || '无序列号'}`, String(index)));
  });
  if (selectedUsbDevice) {
    const selectedIndex = usbDevices.indexOf(selectedUsbDevice);
    if (selectedIndex >= 0) usbDeviceSelect.value = String(selectedIndex);
  }
}

async function refreshSerialDevices() {
  if (!('serial' in navigator)) {
    serialDeviceSelect.innerHTML = '<option value="">当前浏览器不支持 Web Serial</option>';
    return;
  }
  serialPorts = await navigator.serial.getPorts();
  serialDeviceSelect.innerHTML = '';
  if (!serialPorts.length) {
    serialDeviceSelect.add(new Option('尚未发现已授权的串口设备', ''));
    return;
  }
  serialPorts.forEach((port, index) => {
    serialDeviceSelect.add(new Option(portName(port), String(index)));
  });
}

firmwareFile.addEventListener('change', () => {
  selectedFirmware = firmwareFile.files?.[0];
  firmwareName.textContent = selectedFirmware
    ? `${selectedFirmware.name} · ${formatBytes(selectedFirmware.size)}`
    : '尚未选择文件';
  dfuStatus.textContent = selectedFirmware ? '固件已选择，等待 DFU 设备' : '等待设备和固件';
  updateFlashButton();
});

usbDeviceSelect.addEventListener('change', () => {
  selectedUsbDevice = usbDevices[Number(usbDeviceSelect.value)];
  dfuStatus.textContent = selectedUsbDevice ? `已选择：${deviceName(selectedUsbDevice)}` : '等待 DFU 设备';
  updateFlashButton();
});

dfuButton.addEventListener('click', async () => {
  if (!('usb' in navigator)) {
    dfuStatus.textContent = browserMessage('WebUSB');
    return;
  }
  try {
    selectedUsbDevice = await navigator.usb.requestDevice({ filters: [] });
    await refreshUsbDevices();
    const index = usbDevices.indexOf(selectedUsbDevice);
    if (index >= 0) usbDeviceSelect.value = String(index);
    dfuStatus.textContent = `已选择：${deviceName(selectedUsbDevice)}${selectedFirmware ? '' : '，请再选择固件'}`;
    updateFlashButton();
  } catch (error) {
    if (error.name !== 'NotFoundError') dfuStatus.textContent = `连接失败：${error.message}`;
  }
});

flashButton.addEventListener('click', async () => {
  if (!selectedUsbDevice || !selectedFirmware) return;
  dfuStatus.textContent = `已准备 ${selectedFirmware.name}（${formatBytes(selectedFirmware.size)}）`;
  // The transfer step must be matched to the U module's VID/PID and DFU protocol.
  // Do not send arbitrary bytes to an unknown USB device.
  dfuStatus.textContent = '文件和设备已准备；DFU 传输协议待按设备型号接入';
});

refreshUsb.addEventListener('click', () => refreshUsbDevices().catch((error) => {
  dfuStatus.textContent = `刷新失败：${error.message}`;
}));

async function readSerial() {
  if (!serialPort?.readable || monitorRunning) return;
  monitorRunning = true;
  monitorState.textContent = 'RUNNING';
  monitorState.style.color = 'var(--accent)';
  serialReader = serialPort.readable.getReader();
  try {
    while (monitorRunning) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (value) addBytes('<', value);
    }
  } catch (error) {
    if (monitorRunning) addMessage(`读取结束：${error.message}`);
  } finally {
    serialReader.releaseLock();
    serialReader = undefined;
    monitorRunning = false;
    monitorState.textContent = 'STOPPED';
    monitorState.style.color = 'var(--danger)';
  }
}

async function stopReading() {
  monitorRunning = false;
  if (serialReader) await serialReader.cancel();
  monitorState.textContent = 'STOPPED';
  monitorState.style.color = 'var(--danger)';
}

startMonitor.addEventListener('click', () => readSerial());
stopMonitor.addEventListener('click', () => stopReading());

serialButton.addEventListener('click', async () => {
  if (!('serial' in navigator)) {
    serialStatus.textContent = browserMessage('Web Serial');
    return;
  }
  try {
    if (serialPort) {
      await stopReading();
      if (serialWriter) {
        serialWriter.releaseLock();
        serialWriter = undefined;
      }
      await serialPort.close();
      serialPort = undefined;
      serialButton.textContent = '选择串口';
      serialStatus.textContent = '已断开';
      return;
    }
    const selectedIndex = serialDeviceSelect.value;
    serialPort = selectedIndex === '' ? await navigator.serial.requestPort() : serialPorts[Number(selectedIndex)];
    await serialPort.open({ baudRate: Number(baudRate.value) });
    serialWriter = serialPort.writable.getWriter();
    monitorPanel.hidden = false;
    serialButton.textContent = '断开串口';
    serialStatus.textContent = `已连接：${portName(serialPort)}`;
    addMessage(`串口已连接，波特率 ${baudRate.value}`);
    readSerial();
  } catch (error) {
    serialStatus.textContent = error.name === 'NotFoundError' ? '未选择设备' : `连接失败：${error.message}`;
    serialPort = undefined;
    serialWriter = undefined;
  }
});

refreshSerial.addEventListener('click', () => refreshSerialDevices().catch((error) => {
  serialStatus.textContent = `刷新失败：${error.message}`;
}));

function parseHex(value) {
  const tokens = value.trim().replaceAll(',', ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return new Uint8Array();
  const bytes = tokens.map((token) => {
    const normalized = token.replace(/^0x/i, '');
    if (!/^[0-9a-f]{1,2}$/i.test(normalized)) throw new Error(`无效 HEX：${token}`);
    return Number.parseInt(normalized, 16);
  });
  return new Uint8Array(bytes);
}

function appendLineEnding(bytes) {
  if (lineEnding.value === 'lf') return new Uint8Array([...bytes, 0x0a]);
  if (lineEnding.value === 'crlf') return new Uint8Array([...bytes, 0x0d, 0x0a]);
  return bytes;
}

sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!serialWriter || !sendInput.value) return;
  try {
    let bytes = sendFormat.value === 'hex'
      ? parseHex(sendInput.value)
      : new TextEncoder().encode(sendInput.value);
    bytes = appendLineEnding(bytes);
    await serialWriter.write(bytes);
    addBytes('>', bytes);
    sendInput.value = '';
  } catch (error) {
    addMessage(`发送失败：${error.message}`);
  }
});

sendFormat.addEventListener('change', () => {
  sendInput.placeholder = sendFormat.value === 'hex' ? 'HEX：01 03 00 00' : 'TXT 文本';
});
receiveFormat.addEventListener('change', refreshLog);
clearLog.addEventListener('click', () => {
  receivedChunks = [];
  refreshLog();
});

if ('usb' in navigator) {
  navigator.usb.addEventListener('connect', refreshUsbDevices);
  navigator.usb.addEventListener('disconnect', refreshUsbDevices);
}
if ('serial' in navigator) {
  navigator.serial.addEventListener('connect', refreshSerialDevices);
  navigator.serial.addEventListener('disconnect', refreshSerialDevices);
}

refreshUsbDevices();
refreshSerialDevices();
