const dfuButton = document.querySelector('#dfuButton');
const flashButton = document.querySelector('#flashButton');
const flashProgress = document.querySelector('#flashProgress');
const dfuStatus = document.querySelector('#dfuStatus');
const firmwareFile = document.querySelector('#firmwareFile');
const firmwareName = document.querySelector('#firmwareName');
const serialButton = document.querySelector('#serialButton');
const serialStatus = document.querySelector('#serialStatus');
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

const DFU = {
  DNLOAD: 0x01,
  GETSTATUS: 0x03,
  CLRSTATUS: 0x04,
  ABORT: 0x06,
  SET_ADDRESS: 0x21,
  ERASE_SECTOR: 0x41,
  STATE_IDLE: 2,
  STATE_DNLOAD_SYNC: 3,
  STATE_DNBUSY: 4,
  STATE_DNLOAD_IDLE: 5,
  STATE_MANIFEST: 7,
  STATE_MANIFEST_WAIT_RESET: 8,
  STATE_ERROR: 10,
};
const DEFAULT_DFU_TRANSFER_SIZE = 1024;
const STM32_FLASH_START = 0x08000000;
const STM32_H7_SECTOR_SIZE = 128 * 1024;

let usbDevices = [];
let selectedUsbDevice;
let selectedFirmware;
let serialPort;
let serialWriter;
let serialReader;
let monitorRunning = false;
let receivedChunks = [];
let flashing = false;

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
  flashButton.disabled = flashing || !(selectedUsbDevice && selectedFirmware);
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
  receivedChunks.push({ time: new Date().toLocaleTimeString(), message });
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
  if (!('usb' in navigator)) return;
  usbDevices = await navigator.usb.getDevices();
  if (selectedUsbDevice && !usbDevices.includes(selectedUsbDevice)) selectedUsbDevice = undefined;
  updateFlashButton();
}

async function refreshSerialDevices() {
  if (!('serial' in navigator)) return;
  await navigator.serial.getPorts();
}

firmwareFile.addEventListener('change', () => {
  const file = firmwareFile.files?.[0];
  const lowerName = file?.name.toLowerCase() || '';
  if (file && !lowerName.endsWith('.bin') && !lowerName.endsWith('.hex')) {
    selectedFirmware = undefined;
    firmwareName.textContent = '只支持 BIN 或 HEX 文件';
    dfuStatus.textContent = '请选择 .bin 或 .hex 固件';
    updateFlashButton();
    return;
  }
  selectedFirmware = file;
  firmwareName.textContent = selectedFirmware
    ? `${selectedFirmware.name} · ${formatBytes(selectedFirmware.size)}`
    : '尚未选择文件';
  dfuStatus.textContent = selectedFirmware ? '固件已选择，等待 DFU 设备' : '等待设备和固件';
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
    dfuStatus.textContent = `已选择：${deviceName(selectedUsbDevice)}${selectedFirmware ? '' : '，请再选择固件'}`;
    updateFlashButton();
  } catch (error) {
    if (error.name !== 'NotFoundError') dfuStatus.textContent = `连接失败：${error.message}`;
  }
});

function parseIntelHex(text) {
  const records = [];
  let upperAddress = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith(':')) throw new Error('HEX 文件格式错误');
    const bytes = Uint8Array.from(line.slice(1).match(/../g) || [], (pair) => Number.parseInt(pair, 16));
    const length = bytes[0];
    const address = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    if (bytes.length < length + 5) throw new Error('HEX 文件记录长度错误');
    if (type === 0x00) records.push({ address: upperAddress + address, data: bytes.slice(4, 4 + length) });
    if (type === 0x01) break;
    if (type === 0x04) upperAddress = ((bytes[4] << 8) | bytes[5]) << 16;
  }
  if (!records.length) throw new Error('HEX 文件没有固件数据');
  const start = Math.min(...records.map((record) => record.address));
  const end = Math.max(...records.map((record) => record.address + record.data.length));
  const image = new Uint8Array(end - start).fill(0xff);
  for (const record of records) image.set(record.data, record.address - start);
  return { data: image, address: start };
}

async function loadFirmwareImage(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith('.hex')) {
    return parseIntelHex(new TextDecoder().decode(bytes));
  }
  return { data: bytes, address: STM32_FLASH_START };
}

function findDfuInterface(device) {
  const matches = [];
  for (const configuration of device.configurations) {
    for (const intf of configuration.interfaces) {
      for (const alternate of intf.alternates) {
        if (alternate.interfaceClass === 0xfe && alternate.interfaceSubclass === 0x01 && [0x01, 0x02].includes(alternate.interfaceProtocol)) {
          matches.push({ configuration, intf, alternate });
        }
      }
    }
  }
  const internalFlash = matches.find(({ alternate }) => (alternate.interfaceName || '').includes('0x08000000'));
  if (internalFlash) return internalFlash;
  if (matches.length) return matches[0];
  throw new Error('没有找到标准 DFU 接口；请确认设备已经进入 DFU 模式');
}

async function openDfuDevice(device) {
  const settings = findDfuInterface(device);
  await device.open();
  if (!device.configuration || device.configuration.configurationValue !== settings.configuration.configurationValue) {
    await device.selectConfiguration(settings.configuration.configurationValue);
  }
  await device.claimInterface(settings.intf.interfaceNumber);
  if (settings.alternate.alternateSetting !== 0) {
    await device.selectAlternateInterface(settings.intf.interfaceNumber, settings.alternate.alternateSetting);
  }
  return settings;
}

async function dfuOut(device, intfNumber, request, value = 0, data) {
  const setup = { requestType: 'class', recipient: 'interface', request, value, index: intfNumber };
  const result = data === undefined ? await device.controlTransferOut(setup) : await device.controlTransferOut(setup, data);
  if (result.status !== 'ok') throw new Error(`DFU OUT 失败：${result.status}`);
  return result.bytesWritten;
}

async function dfuIn(device, intfNumber, request, length, value = 0) {
  const result = await device.controlTransferIn({ requestType: 'class', recipient: 'interface', request, value, index: intfNumber }, length);
  if (result.status !== 'ok') throw new Error(`DFU IN 失败：${result.status}`);
  return result.data;
}

async function getDfuStatus(device, intfNumber) {
  const data = await dfuIn(device, intfNumber, DFU.GETSTATUS, 6);
  return {
    status: data.getUint8(0),
    pollTimeout: data.getUint8(1) | (data.getUint8(2) << 8) | (data.getUint8(3) << 16),
    state: data.getUint8(4),
  };
}

async function readDfuFunctionalDescriptor(device) {
  const getDescriptor = { requestType: 'standard', recipient: 'device', request: 0x06, value: 0x0200, index: 0 };
  const header = await device.controlTransferIn(getDescriptor, 4);
  if (header.status !== 'ok') return null;
  const totalLength = header.data.getUint16(2, true);
  const result = await device.controlTransferIn(getDescriptor, totalLength);
  if (result.status !== 'ok') return null;
  const data = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
  for (let offset = 0; offset + 2 <= data.length;) {
    const length = data[offset];
    const type = data[offset + 1];
    if (!length || offset + length > data.length) break;
    if (type === 0x21 && length >= 9) {
      return {
        attributes: data[offset + 2],
        manifestationTolerant: Boolean(data[offset + 2] & 0x04),
        canDownload: Boolean(data[offset + 2] & 0x01),
        transferSize: data[offset + 5] | (data[offset + 6] << 8),
        version: data[offset + 7] | (data[offset + 8] << 8),
      };
    }
    offset += length;
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollDfu(device, intfNumber, predicate) {
  let status = await getDfuStatus(device, intfNumber);
  let guard = 0;
  while (!predicate(status.state)) {
    if (status.state === DFU.STATE_ERROR) throw new Error(`DFU 返回错误状态，status=${status.status}`);
    await sleep(Math.max(status.pollTimeout, 10));
    status = await getDfuStatus(device, intfNumber);
    if (++guard > 1200) throw new Error('DFU 等待超时');
  }
  if (status.status !== 0) throw new Error(`DFU 错误码：${status.status}`);
  return status;
}

async function ensureDfuIdle(device, intfNumber) {
  let status = await getDfuStatus(device, intfNumber);
  if (status.state === DFU.STATE_ERROR) {
    await dfuOut(device, intfNumber, DFU.CLRSTATUS);
    status = await getDfuStatus(device, intfNumber);
  }
  if (status.state !== DFU.STATE_IDLE) {
    await dfuOut(device, intfNumber, DFU.ABORT);
    status = await getDfuStatus(device, intfNumber);
  }
  if (status.state !== DFU.STATE_IDLE) throw new Error(`设备无法进入 DFU_IDLE，state=${status.state}`);
}

async function dfuseCommand(device, intfNumber, command, parameter) {
  const payload = new Uint8Array(command === DFU.SET_ADDRESS || command === DFU.ERASE_SECTOR ? 5 : 2);
  payload[0] = command;
  if (payload.length === 5) new DataView(payload.buffer).setUint32(1, parameter, true);
  else payload[1] = parameter;
  await dfuOut(device, intfNumber, DFU.DNLOAD, 0, payload);
  await pollDfu(device, intfNumber, (state) => state !== DFU.STATE_DNBUSY);
}

function parseMemoryDescriptor(descriptor) {
  if (!descriptor) return [];
  const segments = [];
  const sectionPattern = /\/\s*(0x[0-9a-f]+)\s*\/([^/]+)/gi;
  for (const match of descriptor.matchAll(sectionPattern)) {
    let address = Number.parseInt(match[1], 16);
    for (const item of match[2].split(',')) {
      const sector = item.trim().match(/(\d+)\s*\*\s*(\d+)\s*([BKMG])\s*([a-g])/i);
      if (!sector) continue;
      const multiplier = { B: 1, K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 }[sector[3].toUpperCase()];
      const count = Number(sector[1]);
      const size = Number(sector[2]) * multiplier;
      const properties = sector[4].toLowerCase().charCodeAt(0) - 96;
      segments.push({ start: address, end: address + count * size, size, erasable: Boolean(properties & 2) });
      address += count * size;
    }
  }
  return segments;
}

function sectorStart(address, segment) {
  return segment.start + Math.floor((address - segment.start) / segment.size) * segment.size;
}

async function eraseDfuMemory(device, intfNumber, address, length, descriptor) {
  const parsed = parseMemoryDescriptor(descriptor);
  const segments = parsed.length ? parsed : [{ start: STM32_FLASH_START, end: address + length, size: STM32_H7_SECTOR_SIZE, erasable: true }];
  const endAddress = address + length;
  let current = address;
  let erased = 0;
  while (current < endAddress) {
    const segment = segments.find((item) => item.start <= current && current < item.end);
    if (!segment) throw new Error(`固件地址 0x${current.toString(16)} 不在设备 Flash 范围内`);
    const start = sectorStart(current, segment);
    if (segment.erasable) {
      await dfuseCommand(device, intfNumber, DFU.ERASE_SECTOR, start);
    }
    current = Math.min(segment.end, start + segment.size);
    erased = Math.min(length, current - address);
    flashProgress.value = Math.round((erased / length) * 20);
    dfuStatus.textContent = `正在擦除 Flash：${Math.round((erased / length) * 100)}%`;
  }
}

async function flashDfu() {
  if (!selectedUsbDevice || !selectedFirmware || flashing) return;
  flashing = true;
  updateFlashButton();
  flashProgress.hidden = false;
  flashProgress.value = 0;
  let deviceOpened = false;
  try {
    const image = await loadFirmwareImage(selectedFirmware);
    const settings = await openDfuDevice(selectedUsbDevice);
    deviceOpened = true;
    const intfNumber = settings.intf.interfaceNumber;
    await ensureDfuIdle(selectedUsbDevice, intfNumber);
    const descriptor = await readDfuFunctionalDescriptor(selectedUsbDevice);
    const transferSize = descriptor?.transferSize || DEFAULT_DFU_TRANSFER_SIZE;
    if (descriptor && !descriptor.canDownload) throw new Error('DFU 设备不支持下载');
    const manifestationTolerant = descriptor?.manifestationTolerant ?? true;
    const protocol = settings.alternate.interfaceProtocol;
    dfuStatus.textContent = `已连接 DFU 接口：${settings.alternate.interfaceName || '未命名'}，传输块 ${transferSize} 字节`;
    if (protocol === 0x02) {
      await eraseDfuMemory(selectedUsbDevice, intfNumber, image.address, image.data.length, settings.alternate.interfaceName);
      dfuStatus.textContent = '擦除完成，开始写入固件';
      let sent = 0;
      while (sent < image.data.length) {
        const chunk = image.data.slice(sent, sent + transferSize);
        dfuStatus.textContent = `正在写入固件：${Math.round((sent / image.data.length) * 100)}%（第 ${Math.floor(sent / transferSize) + 1} 块）`;
        await dfuseCommand(selectedUsbDevice, intfNumber, DFU.SET_ADDRESS, image.address + sent);
        await dfuOut(selectedUsbDevice, intfNumber, DFU.DNLOAD, 2, chunk);
        await pollDfu(selectedUsbDevice, intfNumber, (state) => state === DFU.STATE_DNLOAD_IDLE);
        sent += chunk.length;
        flashProgress.value = 20 + Math.round((sent / image.data.length) * 75);
        dfuStatus.textContent = `正在写入固件：${Math.round((sent / image.data.length) * 100)}%`;
      }
      await dfuseCommand(selectedUsbDevice, intfNumber, DFU.SET_ADDRESS, image.address);
      await dfuOut(selectedUsbDevice, intfNumber, DFU.DNLOAD, 0, new Uint8Array());
      if (manifestationTolerant) {
        try {
          await pollDfu(selectedUsbDevice, intfNumber, (state) => state === DFU.STATE_MANIFEST || state === DFU.STATE_MANIFEST_WAIT_RESET || state === DFU.STATE_IDLE);
        } catch (error) {
          if (!String(error).match(/NotFound|unavailable|disconnected/i)) throw error;
        }
      } else {
        dfuStatus.textContent = '等待设备重启';
      }
    } else {
      let sent = 0;
      let block = 0;
      while (sent < image.data.length) {
        const chunk = image.data.slice(sent, sent + transferSize);
        dfuStatus.textContent = `正在写入固件：${Math.round((sent / image.data.length) * 100)}%（第 ${block + 1} 块）`;
        await dfuOut(selectedUsbDevice, intfNumber, DFU.DNLOAD, block++, chunk);
        await pollDfu(selectedUsbDevice, intfNumber, (state) => state === DFU.STATE_DNLOAD_IDLE);
        sent += chunk.length;
        flashProgress.value = Math.round((sent / image.data.length) * 95);
        dfuStatus.textContent = `正在写入固件：${Math.round((sent / image.data.length) * 100)}%`;
      }
      await dfuOut(selectedUsbDevice, intfNumber, DFU.DNLOAD, block, new Uint8Array());
      if (manifestationTolerant) {
        try {
          await pollDfu(selectedUsbDevice, intfNumber, (state) => state === DFU.STATE_MANIFEST || state === DFU.STATE_MANIFEST_WAIT_RESET || state === DFU.STATE_IDLE);
        } catch (error) {
          if (!String(error).match(/NotFound|unavailable|disconnected/i)) throw error;
        }
      }
    }
    flashProgress.value = 100;
    dfuStatus.textContent = '烧录完成，设备正在重启';
  } catch (error) {
    dfuStatus.textContent = `烧录失败：${error.message || error}`;
    flashProgress.value = 0;
  } finally {
    if (deviceOpened) {
      try { await selectedUsbDevice.close(); } catch { /* device may reboot after manifestation */ }
    }
    flashing = false;
    updateFlashButton();
  }
}

flashButton.addEventListener('click', flashDfu);

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
      serialButton.textContent = '选择 CDC 设备';
      serialStatus.textContent = '已断开';
      return;
    }
    // Always open the browser chooser so the user explicitly selects the device.
    // Do not silently open the first previously-authorized port from the list.
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: Number(baudRate.value) });
    serialWriter = serialPort.writable.getWriter();
    monitorPanel.hidden = false;
    serialButton.textContent = '断开串口';
    const selectedPortInfo = serialPort.getInfo();
    const usbId = selectedPortInfo.usbVendorId && selectedPortInfo.usbProductId
      ? ` · USB ${selectedPortInfo.usbVendorId.toString(16).padStart(4, '0')}:${selectedPortInfo.usbProductId.toString(16).padStart(4, '0')}`
      : '';
    serialStatus.textContent = `已连接：${portName(serialPort)}${usbId}，等待数据`;
    addMessage(`串口已连接：${portName(serialPort)}${usbId}，波特率 ${baudRate.value}`);
    readSerial();
  } catch (error) {
    serialStatus.textContent = error.name === 'NotFoundError' ? '未选择设备' : `连接失败：${error.message}`;
    serialPort = undefined;
    serialWriter = undefined;
  }
});


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
    let bytes = sendFormat.value === 'hex' ? parseHex(sendInput.value) : new TextEncoder().encode(sendInput.value);
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

function initSpaceScene() {
  const canvas = document.querySelector('#spaceCanvas');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const stars = Array.from({ length: 420 }, (_, index) => ({
    x: ((index * 97) % 1000) / 1000,
    y: ((index * 53) % 1000) / 1000,
    z: ((index * 71) % 1000) / 1000,
    size: 0.35 + ((index * 19) % 100) / 130,
    tint: index % 7 === 0 ? 'cyan' : index % 11 === 0 ? 'pink' : 'white',
  }));
  const bodies = [
    { key: 'eurorack', label: 'Eurorack', x: -0.65, y: -0.18, z: 0.35, radius: 41, color: '#77e7ff', target: '#products' },
    { key: 'fx', label: 'FX Pedal', x: 0.16, y: -0.52, z: 0.7, radius: 27, color: '#fb8dca', target: '#products' },
    { key: 'vst', label: 'VST', x: 0.74, y: -0.13, z: 0.24, radius: 34, color: '#a88bff', target: '#products' },
    { key: 'max', label: 'Max/MSP', x: -0.42, y: 0.48, z: 0.55, radius: 29, color: '#c5ff76', target: '#products' },
    { key: 'macos', label: 'macOS App', x: 0.35, y: 0.56, z: 0.82, radius: 24, color: '#8db6ff', target: '#products' },
    { key: 'tools', label: 'Device Bridge', x: 0.02, y: 0.08, z: 0.08, radius: 53, color: '#77e7ff', target: '#tools' },
  ];
  let width = 0;
  let height = 0;
  let yaw = 0;
  let pitch = 0;
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let projectedBodies = [];

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function rotate(point) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const x = point.x * cy - point.z * sy;
    const z = point.x * sy + point.z * cy;
    return { x, y: point.y * cp - z * sp, z: point.y * sp + z * cp };
  }

  function project(point) {
    const rotated = rotate(point);
    const depth = rotated.z + 1.45;
    const scale = Math.min(width, height) * 0.45 / depth;
    return { x: width / 2 + rotated.x * scale, y: height / 2 + rotated.y * scale, scale, depth };
  }

  function drawGlow(x, y, radius, color, alpha = 1) {
    const glow = context.createRadialGradient(x, y, radius * .05, x, y, radius * 1.8);
    glow.addColorStop(0, `${color}${Math.round(0.7 * alpha * 255).toString(16).padStart(2, '0')}`);
    glow.addColorStop(.35, `${color}${Math.round(0.18 * alpha * 255).toString(16).padStart(2, '0')}`);
    glow.addColorStop(1, `${color}00`);
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, radius * 1.8, 0, Math.PI * 2);
    context.fill();
  }

  function draw(time) {
    context.clearRect(0, 0, width, height);
    const background = context.createRadialGradient(width * .5, height * .45, 0, width * .5, height * .45, Math.max(width, height) * .7);
    background.addColorStop(0, '#16163b');
    background.addColorStop(.42, '#090b20');
    background.addColorStop(1, '#04050e');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    stars.forEach((star) => {
      const drift = (time * 0.000012 * (1 - star.z) + yaw * .04) % 1;
      const x = ((star.x + drift + 1) % 1) * width;
      const y = ((star.y + pitch * .08 + 1) % 1) * height;
      const alpha = .18 + (1 - star.z) * .62;
      const colors = { cyan: '#77e7ff', pink: '#fb8dca', white: '#dce3ff' };
      context.fillStyle = colors[star.tint];
      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(x, y, star.size * (1.2 - star.z * .5), 0, Math.PI * 2);
      context.fill();
    });
    context.globalAlpha = 1;

    const nebula = context.createRadialGradient(width * .32, height * .62, 0, width * .32, height * .62, width * .36);
    nebula.addColorStop(0, 'rgba(123, 73, 255, .16)');
    nebula.addColorStop(1, 'rgba(123, 73, 255, 0)');
    context.fillStyle = nebula;
    context.fillRect(0, 0, width, height);

    projectedBodies = bodies.map((body) => ({ body, ...project(body) })).sort((a, b) => b.depth - a.depth);
    projectedBodies.forEach(({ body, x, y, scale, depth }) => {
      const radius = Math.max(8, body.radius * Math.min(1.35, scale / (Math.min(width, height) * .34)));
      drawGlow(x, y, radius, body.color, depth < 1.4 ? 1.1 : .72);
      context.globalAlpha = .8;
      context.strokeStyle = body.color;
      context.lineWidth = 1;
      context.beginPath();
      context.ellipse(x, y, radius * 1.9, radius * .54, -0.25, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 1;
      const planet = context.createRadialGradient(x - radius * .35, y - radius * .45, radius * .05, x, y, radius);
      planet.addColorStop(0, '#ffffff');
      planet.addColorStop(.08, body.color);
      planet.addColorStop(.52, `${body.color}bb`);
      planet.addColorStop(1, '#080a1f');
      context.fillStyle = planet;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = `${body.color}aa`;
      context.stroke();
      if (body.key === 'tools') {
        context.strokeStyle = 'rgba(255,255,255,.44)';
        context.beginPath();
        context.arc(x, y, radius * .72, 0, Math.PI * 2);
        context.stroke();
      }
      context.fillStyle = '#edf0ff';
      context.font = '10px "DM Mono", monospace';
      context.textAlign = 'center';
      context.fillText(body.label.toUpperCase(), x, y + radius + 17);
    });

    requestAnimationFrame(draw);
  }

  function focusWorld(key) {
    const body = bodies.find((item) => item.key === key);
    if (!body) return;
    yaw += body.x * .12;
    pitch -= body.y * .08;
    const target = document.querySelector(body.target);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    moved = false;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.classList.add('is-dragging');
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    yaw += dx * .004;
    pitch = Math.max(-.9, Math.min(.9, pitch + dy * .003));
    lastX = event.clientX;
    lastY = event.clientY;
  });
  canvas.addEventListener('pointerup', (event) => {
    dragging = false;
    canvas.classList.remove('is-dragging');
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('click', (event) => {
    if (moved) return;
    const hit = projectedBodies.find(({ x, y, body, scale }) => {
      const radius = Math.max(8, body.radius * Math.min(1.35, scale / (Math.min(width, height) * .34)));
      return Math.hypot(event.clientX - x, event.clientY - y) < radius + 16;
    });
    if (hit) focusWorld(hit.body.key);
  });
  document.querySelectorAll('[data-world]').forEach((tag) => {
    tag.addEventListener('click', () => focusWorld(tag.dataset.world));
  });
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
}

initSpaceScene();
refreshUsbDevices();
refreshSerialDevices();
