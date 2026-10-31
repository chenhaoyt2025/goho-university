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
  const labelLayer = document.querySelector('#worldLabels');
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
  if (!gl) {
    document.querySelector('.space-app')?.classList.add('no-webgl');
    return;
  }

  const bodies = [
    { key: 'tools', label: 'DEVICE BRIDGE', position: [0, -1, -15], radius: 2.6, color: [0.28, 0.86, 1], glow: 1.35, target: '#tools' },
    { key: 'eurorack', label: 'EURORACK', position: [-19, 5, -36], radius: 3.9, color: [0.26, 0.72, 1], glow: 1.1, target: '#products' },
    { key: 'fx', label: 'FX PEDAL', position: [15, -8, -28], radius: 2.9, color: [1, 0.33, 0.66], glow: 1.2, target: '#products' },
    { key: 'vst', label: 'VST', position: [26, 11, -58], radius: 4.5, color: [0.55, 0.42, 1], glow: 1.1, target: '#products' },
    { key: 'max', label: 'MAX / MSP', position: [-31, -12, -47], radius: 3.25, color: [0.67, 1, 0.31], glow: 1.1, target: '#products' },
    { key: 'macos', label: 'MACOS APP', position: [10, 20, -76], radius: 2.65, color: [0.36, 0.62, 1], glow: 1.0, target: '#products' },
    { key: 'satellite', label: 'U MODULE', position: [36, 16, 24], radius: 1.8, color: [0.93, 0.72, 0.4], glow: .8, target: '#products' },
    { key: 'neutron', label: 'NOISE STAR', position: [-42, 14, 18], radius: 2.2, color: [0.7, 0.33, 1], glow: 1.5, target: '#products' },
  ];

  const stars = [];
  let seed = 1837;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < 1400; index += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const radius = 85 + random() * 235;
    const tint = index % 13 === 0 ? [0.45, 0.88, 1] : index % 17 === 0 ? [1, 0.42, 0.73] : [0.66 + random() * .3, 0.73 + random() * .22, 1];
    stars.push(
      Math.sin(phi) * Math.cos(theta) * radius,
      Math.cos(phi) * radius,
      Math.sin(phi) * Math.sin(theta) * radius,
      1.8 + random() * 2.4,
      tint[0], tint[1], tint[2],
    );
  }

  const vertexShader = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uProjection;
    uniform mat4 uView;
    uniform mat4 uModel;
    varying vec3 vNormal;
    varying vec3 vWorld;
    void main() {
      vec4 world = uModel * vec4(aPosition, 1.0);
      vNormal = aNormal;
      vWorld = world.xyz;
      gl_Position = uProjection * uView * world;
    }
  `;
  const fragmentShader = `
    precision mediump float;
    uniform vec3 uColor;
    uniform vec3 uLight;
    uniform float uGlow;
    varying vec3 vNormal;
    varying vec3 vWorld;
    void main() {
      vec3 normal = normalize(vNormal);
      vec3 lightDirection = normalize(uLight - vWorld);
      float diffuse = max(dot(normal, lightDirection), 0.0);
      vec3 viewDirection = normalize(-vWorld);
      float rim = pow(1.0 - max(dot(viewDirection, normal), 0.0), 2.4);
      vec3 color = uColor * (0.16 + diffuse * 0.92);
      color += vec3(0.24, 0.38, 0.7) * rim * uGlow;
      gl_FragColor = vec4(color, 1.0);
    }
  `;
  const starVertexShader = `
    attribute vec3 aPosition;
    attribute float aSize;
    attribute vec3 aColor;
    uniform mat4 uProjection;
    uniform mat4 uView;
    varying vec3 vColor;
    void main() {
      vec4 clip = uProjection * uView * vec4(aPosition, 1.0);
      gl_Position = clip;
      gl_PointSize = max(1.0, aSize * (88.0 / max(1.0, clip.w)));
      vColor = aColor;
    }
  `;
  const starFragmentShader = `
    precision mediump float;
    varying vec3 vColor;
    void main() {
      float distanceFromCenter = distance(gl_PointCoord, vec2(0.5));
      if (distanceFromCenter > 0.5) discard;
      float alpha = smoothstep(0.5, 0.05, distanceFromCenter);
      gl_FragColor = vec4(vColor, alpha);
    }
  `;

  function compileShader(source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }

  function createProgram(vertexSource, fragmentSource) {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(vertexSource, gl.VERTEX_SHADER));
    gl.attachShader(program, compileShader(fragmentSource, gl.FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  }

  function createBuffer(data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, usage);
    return buffer;
  }

  function createSphere(rows = 28, columns = 40) {
    const positions = [];
    const normals = [];
    const indices = [];
    for (let row = 0; row <= rows; row += 1) {
      const v = row / rows;
      const phi = v * Math.PI;
      for (let column = 0; column <= columns; column += 1) {
        const u = column / columns;
        const theta = u * Math.PI * 2;
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.cos(phi);
        const z = Math.sin(phi) * Math.sin(theta);
        positions.push(x, y, z);
        normals.push(x, y, z);
      }
    }
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const first = row * (columns + 1) + column;
        const second = first + columns + 1;
        indices.push(first, second, first + 1, second, second + 1, first + 1);
      }
    }
    return {
      position: createBuffer(new Float32Array(positions)),
      normal: createBuffer(new Float32Array(normals)),
      index: createBuffer(new Uint16Array(indices), gl.ELEMENT_ARRAY_BUFFER),
      count: indices.length,
    };
  }

  const sphere = createSphere();
  const starPosition = createBuffer(new Float32Array(stars));
  const bodyProgram = createProgram(vertexShader, fragmentShader);
  const starProgram = createProgram(starVertexShader, starFragmentShader);
  const bodyAttributes = {
    position: gl.getAttribLocation(bodyProgram, 'aPosition'),
    normal: gl.getAttribLocation(bodyProgram, 'aNormal'),
  };
  const bodyUniforms = {
    projection: gl.getUniformLocation(bodyProgram, 'uProjection'),
    view: gl.getUniformLocation(bodyProgram, 'uView'),
    model: gl.getUniformLocation(bodyProgram, 'uModel'),
    color: gl.getUniformLocation(bodyProgram, 'uColor'),
    light: gl.getUniformLocation(bodyProgram, 'uLight'),
    glow: gl.getUniformLocation(bodyProgram, 'uGlow'),
  };
  const starAttributes = {
    position: gl.getAttribLocation(starProgram, 'aPosition'),
    size: gl.getAttribLocation(starProgram, 'aSize'),
    color: gl.getAttribLocation(starProgram, 'aColor'),
  };
  const starUniforms = {
    projection: gl.getUniformLocation(starProgram, 'uProjection'),
    view: gl.getUniformLocation(starProgram, 'uView'),
  };

  function identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] = a[row] * b[column * 4]
          + a[4 + row] * b[column * 4 + 1]
          + a[8 + row] * b[column * 4 + 2]
          + a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const range = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * range, -1,
      0, 0, near * far * 2 * range, 0,
    ]);
  }

  function rotateX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  }

  function rotateY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }

  function modelMatrix(position, radius) {
    const matrix = identity();
    matrix[0] = radius;
    matrix[5] = radius;
    matrix[10] = radius;
    matrix[12] = position[0];
    matrix[13] = position[1];
    matrix[14] = position[2];
    return matrix;
  }

  function transformPoint(matrix, point) {
    return {
      x: matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
      y: matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
      z: matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
      w: matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15],
    };
  }

  let width = 0;
  let height = 0;
  let yaw = 0;
  let pitch = 0;
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let projection = identity();
  let view = identity();
  let viewProjection = identity();
  let dragDistance = 0;

  if (labelLayer) {
    bodies.forEach((body) => {
      const label = document.createElement('span');
      label.className = `world-label world-label-${body.key}`;
      label.textContent = body.label;
      labelLayer.append(label);
      body.labelElement = label;
    });
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);
    projection = perspective(Math.PI / 2.8, width / height, .1, 500);
  }

  function updateCamera() {
    view = multiply(rotateX(-pitch), rotateY(-yaw));
    viewProjection = multiply(projection, view);
  }

  function updateLabels() {
    bodies.forEach((body) => {
      if (!body.labelElement) return;
      const point = transformPoint(viewProjection, [body.position[0], body.position[1] + body.radius * 1.35, body.position[2]]);
      const visible = point.w > 0 && point.z > -point.w && point.z < point.w && point.x > -point.w && point.x < point.w && point.y > -point.w && point.y < point.w;
      body.labelElement.hidden = !visible;
      if (visible) {
        const x = (point.x / point.w * .5 + .5) * width;
        const y = (-point.y / point.w * .5 + .5) * height;
        body.labelElement.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        body.labelElement.style.setProperty('--world-color', `rgb(${body.color.map((value) => Math.round(value * 255)).join(',')})`);
      }
    });
  }

  function render() {
    updateCamera();
    gl.clearColor(.015, .018, .05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(starProgram);
    gl.disable(gl.DEPTH_TEST);
    gl.bindBuffer(gl.ARRAY_BUFFER, starPosition);
    gl.enableVertexAttribArray(starAttributes.position);
    gl.vertexAttribPointer(starAttributes.position, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(starAttributes.size);
    gl.vertexAttribPointer(starAttributes.size, 1, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(starAttributes.color);
    gl.vertexAttribPointer(starAttributes.color, 3, gl.FLOAT, false, 28, 16);
    gl.uniformMatrix4fv(starUniforms.projection, false, projection);
    gl.uniformMatrix4fv(starUniforms.view, false, view);
    gl.drawArrays(gl.POINTS, 0, stars.length / 7);

    gl.useProgram(bodyProgram);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.bindBuffer(gl.ARRAY_BUFFER, sphere.position);
    gl.enableVertexAttribArray(bodyAttributes.position);
    gl.vertexAttribPointer(bodyAttributes.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, sphere.normal);
    gl.enableVertexAttribArray(bodyAttributes.normal);
    gl.vertexAttribPointer(bodyAttributes.normal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphere.index);
    gl.uniformMatrix4fv(bodyUniforms.projection, false, projection);
    gl.uniformMatrix4fv(bodyUniforms.view, false, view);
    gl.uniform3f(bodyUniforms.light, -35, 45, 25);
    bodies.forEach((body) => {
      gl.uniformMatrix4fv(bodyUniforms.model, false, modelMatrix(body.position, body.radius));
      gl.uniform3fv(bodyUniforms.color, body.color);
      gl.uniform1f(bodyUniforms.glow, body.glow);
      gl.drawElements(gl.TRIANGLES, sphere.count, gl.UNSIGNED_SHORT, 0);
    });
    updateLabels();
    requestAnimationFrame(render);
  }

  function focusWorld(key) {
    const body = bodies.find((item) => item.key === key);
    if (!body) return;
    yaw = Math.atan2(-body.position[0], -body.position[2]);
    pitch = Math.atan2(body.position[1], Math.hypot(body.position[0], body.position[2]));
    document.querySelector(body.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function screenPosition(body) {
    const point = transformPoint(viewProjection, body.position);
    if (point.w <= 0) return undefined;
    return {
      x: (point.x / point.w * .5 + .5) * width,
      y: (-point.y / point.w * .5 + .5) * height,
      radius: Math.max(10, body.radius * (height / (2 * Math.tan(Math.PI / 5.6))) / point.w),
    };
  }

  function isInteractiveTarget(target) {
    return Boolean(target?.closest('a, button, input, select, textarea, label, form'));
  }

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    dragging = true;
    moved = false;
    dragDistance = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    document.body.classList.add('is-dragging');
  });
  document.addEventListener('selectstart', (event) => {
    if (dragging) event.preventDefault();
  });
  document.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    dragDistance += Math.abs(dx) + Math.abs(dy);
    yaw -= dx * .0045;
    pitch = Math.max(-Math.PI / 2 + .08, Math.min(Math.PI / 2 - .08, pitch - dy * .0045));
    lastX = event.clientX;
    lastY = event.clientY;
  });
  document.addEventListener('pointerup', () => {
    dragging = false;
    document.body.classList.remove('is-dragging');
    if (dragDistance > 8) document.querySelector('.status-pill')?.replaceChildren(Object.assign(document.createElement('i'), { className: '' }), document.createTextNode(' 3D FLIGHT'));
    dragDistance = 0;
  });
  document.addEventListener('click', (event) => {
    if (moved || isInteractiveTarget(event.target)) return;
    updateCamera();
    const hit = bodies.map((body) => ({ body, position: screenPosition(body) })).filter((item) => item.position).sort((a, b) => a.position.radius - b.position.radius).find(({ position }) => Math.hypot(event.clientX - position.x, event.clientY - position.y) < position.radius + 18);
    if (hit) focusWorld(hit.body.key);
  });
  document.querySelectorAll('[data-world]').forEach((tag) => {
    tag.addEventListener('click', () => focusWorld(tag.dataset.world));
  });
  window.addEventListener('resize', resize);
  resize();
  render();
}
try {
  initSpaceScene();
} catch (error) {
  console.error('3D scene failed to start:', error);
  const sceneStatus = document.querySelector('.status-pill');
  if (sceneStatus) sceneStatus.innerHTML = '<i></i> 3D SCENE ERROR';
}
refreshUsbDevices();
refreshSerialDevices();
