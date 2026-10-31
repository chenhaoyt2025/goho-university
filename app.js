const dfuButton = document.querySelector('#dfuButton');
const flashButton = document.querySelector('#flashButton');
const flashProgress = document.querySelector('#flashProgress');
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
const DFU_TRANSFER_SIZE = 2048;
const STM32_FLASH_START = 0x08000000;
const STM32_H7_SECTOR_SIZE = 128 * 1024;

let usbDevices = [];
let serialPorts = [];
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
  for (const configuration of device.configurations) {
    for (const intf of configuration.interfaces) {
      for (const alternate of intf.alternates) {
        if (alternate.interfaceClass === 0xfe && alternate.interfaceSubclass === 0x01 && [0x01, 0x02].includes(alternate.interfaceProtocol)) {
          return { configuration, intf, alternate };
        }
      }
    }
  }
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
    const protocol = settings.alternate.interfaceProtocol;
    if (protocol === 0x02) {
      await eraseDfuMemory(selectedUsbDevice, intfNumber, image.address, image.data.length, settings.alternate.interfaceName);
      let sent = 0;
      while (sent < image.data.length) {
        const chunk = image.data.slice(sent, sent + DFU_TRANSFER_SIZE);
        await dfuseCommand(selectedUsbDevice, intfNumber, DFU.SET_ADDRESS, image.address + sent);
        await dfuOut(selectedUsbDevice, intfNumber, DFU.DNLOAD, 2, chunk);
        await pollDfu(selectedUsbDevice, intfNumber, (state) => state === DFU.STATE_DNLOAD_IDLE);
        sent += chunk.length;
        flashProgress.value = 20 + Math.round((sent / image.data.length) * 75);
        dfuStatus.textContent = `正在写入固件：${Math.round((sent / image.data.length) * 100)}%`;
      }
      await dfuseCommand(selectedUsbDevice, intfNumber, DFU.SET_ADDRESS, image.address);
      await dfuOut(selectedUsbDevice, intfNumber, DFU.DNLOAD, 0, new Uint8Array());
      await pollDfu(selectedUsbDevice, intfNumber, (state) => state === DFU.STATE_MANIFEST || state === DFU.STATE_MANIFEST_WAIT_RESET || state === DFU.STATE_IDLE);
    } else {
      let sent = 0;
      let block = 0;
      while (sent < image.data.length) {
        const chunk = image.data.slice(sent, sent + DFU_TRANSFER_SIZE);
        await dfuOut(selectedUsbDevice, intfNumber, DFU.DNLOAD, block++, chunk);
        await pollDfu(selectedUsbDevice, intfNumber, (state) => state === DFU.STATE_DNLOAD_IDLE);
        sent += chunk.length;
        flashProgress.value = Math.round((sent / image.data.length) * 95);
        dfuStatus.textContent = `正在写入固件：${Math.round((sent / image.data.length) * 100)}%`;
      }
      await dfuOut(selectedUsbDevice, intfNumber, DFU.DNLOAD, block, new Uint8Array());
      await pollDfu(selectedUsbDevice, intfNumber, (state) => state === DFU.STATE_MANIFEST || state === DFU.STATE_MANIFEST_WAIT_RESET || state === DFU.STATE_IDLE);
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

refreshUsbDevices();
refreshSerialDevices();
