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
const virtualDiskButton = document.querySelector('#virtualDiskButton');
const virtualDiskFile = document.querySelector('#virtualDiskFile');
const virtualDiskDropZone = document.querySelector('#virtualDiskDropZone');
const virtualDiskProgress = document.querySelector('#virtualDiskProgress');
const virtualDiskFileName = document.querySelector('#virtualDiskFileName');
const virtualDiskStatus = document.querySelector('#virtualDiskStatus');
const virtualDiskModeToggle = document.querySelector('#virtualDiskModeToggle');
const enterVirtualDiskButton = document.querySelector('#enterVirtualDiskButton');
const audioRefreshButton = document.querySelector('#audioRefreshButton');
const audioInputSelect = document.querySelector('#audioInputSelect');
const audioStartButton = document.querySelector('#audioStartButton');
const audioStopButton = document.querySelector('#audioStopButton');
const audioVolume = document.querySelector('#audioVolume');
const audioVolumeValue = document.querySelector('#audioVolumeValue');
const audioStatus = document.querySelector('#audioStatus');

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
const VIRTUAL_DISK_VOLUME_NAME = 'GOHO UPDATE';
const VIRTUAL_DISK_COMMAND = 'XXX';
const GOHO_USB_VENDOR_ID = 0x0483;
const GOHO_USB_PRODUCT_ID = 0x4011;
const VIRTUAL_DISK_FIRMWARE_NAME = 'UPDATE.BIN';
// bootloader_no_wav: 1024 sectors - 11 FAT/root sectors - 1 README cluster.
const VIRTUAL_DISK_MAX_FIRMWARE_BYTES = (1024 - 11 - 1) * 512;
const VIRTUAL_DISK_POLL_INTERVAL_MS = 600;
const VIRTUAL_DISK_POLL_TIMEOUT_MS = 45000;
const VIRTUAL_DISK_MOUNT_TIMEOUT_MS = 20000;
const VIRTUAL_DISK_HANDLE_DB = 'goho-university-device-handles';
const VIRTUAL_DISK_HANDLE_STORE = 'handles';
const VIRTUAL_DISK_HANDLE_KEY = 'goho-update-root';

let usbDevices = [];
let selectedUsbDevice;
let selectedFirmware;
let serialPort;
let serialWriter;
let serialReader;
let monitorRunning = false;
let receivedChunks = [];
let flashing = false;
let virtualDiskHandle;
let virtualDiskBusy = false;
let virtualDiskPollToken = 0;
let virtualDiskReady = false;
let pendingVirtualDiskFile;
let audioInputDevices = [];
let audioStream;
let audioContext;
let audioSource;
let audioGain;

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

function setVirtualDiskStatus(message) {
  virtualDiskStatus.textContent = message;
}

function updateVirtualDiskModeToggle() {
  const connected = Boolean(serialPort && serialWriter);
  virtualDiskModeToggle.disabled = !connected || virtualDiskBusy;
  if (!connected && virtualDiskModeToggle.checked) {
    virtualDiskModeToggle.checked = false;
  }
}

function setVirtualDiskBindingPrompt(visible, label = '绑定 GOHO UPDATE') {
  virtualDiskButton.hidden = !visible;
  virtualDiskButton.textContent = label;
}

function setVirtualDiskReady(ready) {
  virtualDiskReady = ready;
  virtualDiskDropZone.classList.toggle('is-ready', !virtualDiskBusy);
  virtualDiskDropZone.classList.toggle('is-mounted', ready);
  virtualDiskDropZone.setAttribute('aria-disabled', String(Boolean(virtualDiskBusy)));
}

function normalizeVolumeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function isReadmeName(name) {
  return String(name || '').toUpperCase().replace(/\s+/g, '') === 'README.TXT';
}

function isDiskGoneError(error) {
  return ['AbortError', 'InvalidStateError', 'NotFoundError', 'NotReadableError'].includes(error?.name)
    || /not found|not readable|invalid state|disconnected|no longer available|已移除|不可用/i.test(error?.message || '');
}

function openVirtualDiskHandleDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('浏览器不支持本地设备记忆'));
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(VIRTUAL_DISK_HANDLE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(VIRTUAL_DISK_HANDLE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地设备记忆'));
  });
}

async function saveRememberedVirtualDisk(handle) {
  try {
    const db = await openVirtualDiskHandleDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(VIRTUAL_DISK_HANDLE_STORE, 'readwrite');
      transaction.objectStore(VIRTUAL_DISK_HANDLE_STORE).put(handle, VIRTUAL_DISK_HANDLE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('无法保存 GOHO UPDATE 记忆'));
    });
    db.close();
  } catch {
    // The app still works for the current tab if IndexedDB is unavailable.
  }
}

async function loadRememberedVirtualDisk() {
  try {
    const db = await openVirtualDiskHandleDb();
    const handle = await new Promise((resolve, reject) => {
      const transaction = db.transaction(VIRTUAL_DISK_HANDLE_STORE, 'readonly');
      const request = transaction.objectStore(VIRTUAL_DISK_HANDLE_STORE).get(VIRTUAL_DISK_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法读取 GOHO UPDATE 记忆'));
    });
    db.close();
    return handle;
  } catch {
    return undefined;
  }
}

async function clearRememberedVirtualDisk() {
  try {
    const db = await openVirtualDiskHandleDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(VIRTUAL_DISK_HANDLE_STORE, 'readwrite');
      transaction.objectStore(VIRTUAL_DISK_HANDLE_STORE).delete(VIRTUAL_DISK_HANDLE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('无法清除 GOHO UPDATE 记忆'));
    });
    db.close();
  } catch {
    // Nothing else to do; manual binding remains available.
  }
}

async function readDirectoryEntries(directoryHandle) {
  const entries = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    entries.push({ name, handle });
  }
  return entries;
}

async function inspectVirtualDisk(directoryHandle) {
  const entries = await readDirectoryEntries(directoryHandle);
  const readme = entries.find(({ name, handle }) => handle.kind === 'file' && isReadmeName(name));
  let hasGohoMarker = false;
  if (readme) {
    const readmeFile = await readme.handle.getFile();
    const text = await readmeFile.slice(0, 128).text();
    hasGohoMarker = text.includes('GOHO_v1 USB UPDATE');
  }
  const hasVolumeName = normalizeVolumeName(directoryHandle.name) === VIRTUAL_DISK_VOLUME_NAME;
  if (!hasVolumeName && !hasGohoMarker) {
    throw new Error('没有找到 GOHO UPDATE 或 README.TXT，请先让设备进入虚拟磁盘模式');
  }
  return { entries, hasGohoMarker, hasVolumeName };
}

async function requestVirtualDiskPermission(directoryHandle, { request = false } = {}) {
  let permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted' && request) {
    permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
  }
  return permission === 'granted';
}

function virtualDiskBinNames(entries) {
  return entries
    .filter(({ name, handle }) => handle.kind === 'file' && /\.bin$/i.test(name))
    .map(({ name }) => name);
}

function readUint32LE(bytes, offset) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function isRamAddress(address) {
  return (address >= 0x20000000 && address <= 0x20020000)
    || (address >= 0x24000000 && address <= 0x24080000)
    || (address >= 0x30000000 && address <= 0x30040000)
    || (address >= 0x38000000 && address <= 0x38010000);
}

function validateVirtualDiskImage(bytes) {
  if (bytes.length < 8) throw new Error('应用 BIN 太小，无法读取向量表');
  const initialSp = readUint32LE(bytes, 0);
  const resetHandler = readUint32LE(bytes, 4);
  if ((initialSp & 7) !== 0 || !isRamAddress(initialSp)) {
    throw new Error('这个 BIN 不是虚拟磁盘需要的应用镜像（首地址不是有效 RAM 栈地址）');
  }
  const handler = resetHandler & ~1;
  if ((resetHandler & 1) === 0 || handler < 0x08020000 || handler >= 0x081e0000) {
    throw new Error('这个 BIN 包含 bootloader + 应用 combo；虚拟磁盘只接受 application-only BIN，请用 DFU 烧录 combo');
  }
}

function updateVirtualDiskMount(info) {
  virtualDiskReady = true;
  setVirtualDiskReady(true);
  setVirtualDiskBindingPrompt(false);
  const binNames = virtualDiskBinNames(info.entries);
  virtualDiskFileName.textContent = `${VIRTUAL_DISK_VOLUME_NAME} · ${binNames.length ? `已有 ${binNames.join(', ')}` : '可写入'}`;
  setVirtualDiskStatus(binNames.length
    ? 'GOHO UPDATE 已连接；如不是 UPDATE.BIN，请先移除旧 BIN'
    : 'GOHO UPDATE 已连接，等待固件');
  if (pendingVirtualDiskFile) {
    const file = pendingVirtualDiskFile;
    pendingVirtualDiskFile = undefined;
    void loadVirtualDiskFile(file);
  }
}

async function chooseVirtualDisk() {
  if (!('showDirectoryPicker' in window)) {
    setVirtualDiskStatus(browserMessage('File System Access API'));
    return;
  }
  try {
    const candidate = await window.showDirectoryPicker({
      id: 'goho-update-disk',
      mode: 'readwrite',
    });
    if (normalizeVolumeName(candidate.name) !== VIRTUAL_DISK_VOLUME_NAME) {
      throw new Error(`请选择名为 ${VIRTUAL_DISK_VOLUME_NAME} 的设备`);
    }
    if (!await requestVirtualDiskPermission(candidate, { request: true })) {
      throw new Error('没有获得 GOHO UPDATE 的读写权限');
    }
    const info = await inspectVirtualDisk(candidate);
    virtualDiskHandle = candidate;
    virtualDiskPollToken += 1;
    await saveRememberedVirtualDisk(candidate);
    updateVirtualDiskMount(info);
    setVirtualDiskStatus('GOHO UPDATE 已绑定；以后连接 CDC 后会自动寻找');
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'NotAllowedError') {
      setVirtualDiskStatus('未绑定 GOHO UPDATE');
      return;
    }
    setVirtualDiskStatus(`绑定失败：${error.message || error}`);
  }
}

async function restoreRememberedVirtualDisk() {
  if (!('showDirectoryPicker' in window)) {
    setVirtualDiskStatus(browserMessage('File System Access API'));
    setVirtualDiskBindingPrompt(true, '浏览器不支持自动连接');
    return;
  }
  const remembered = await loadRememberedVirtualDisk();
  if (!remembered) {
    setVirtualDiskStatus(`首次使用请绑定 ${VIRTUAL_DISK_VOLUME_NAME}（只需一次）`);
    setVirtualDiskBindingPrompt(true);
    return;
  }
  if (normalizeVolumeName(remembered.name) !== VIRTUAL_DISK_VOLUME_NAME) {
    await clearRememberedVirtualDisk();
    setVirtualDiskStatus(`已清除旧设备，请绑定 ${VIRTUAL_DISK_VOLUME_NAME}`);
    setVirtualDiskBindingPrompt(true);
    return;
  }
  virtualDiskHandle = remembered;
  setVirtualDiskBindingPrompt(false);
  setVirtualDiskReady(false);
  virtualDiskFileName.textContent = `${VIRTUAL_DISK_VOLUME_NAME} · 等待设备连接`;
  if (await requestVirtualDiskPermission(remembered)) {
    try {
      updateVirtualDiskMount(await inspectVirtualDisk(remembered));
      return;
    } catch (error) {
      if (!isDiskGoneError(error)) setVirtualDiskStatus(`等待 ${VIRTUAL_DISK_VOLUME_NAME}：${error.message || error}`);
    }
  }
  setVirtualDiskStatus(`${VIRTUAL_DISK_VOLUME_NAME} 已记忆；连接 CDC 后会自动寻找`);
}

async function waitForVirtualDiskMount() {
  if (!virtualDiskHandle) return false;
  const token = ++virtualDiskPollToken;
  const started = Date.now();
  while (token === virtualDiskPollToken && Date.now() - started < VIRTUAL_DISK_MOUNT_TIMEOUT_MS) {
    try {
      if (await requestVirtualDiskPermission(virtualDiskHandle)) {
        updateVirtualDiskMount(await inspectVirtualDisk(virtualDiskHandle));
        return true;
      }
    } catch (error) {
      if (!isDiskGoneError(error) && /没有找到 GOHO UPDATE|README/i.test(error.message || '')) {
        // The remembered directory exists, but it is not the fixed GOHO UPDATE volume.
        break;
      }
    }
    await sleep(VIRTUAL_DISK_POLL_INTERVAL_MS);
  }
  return false;
}

function queueVirtualDiskFile(file) {
  if (!file) return;
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.bin')) {
    setVirtualDiskStatus('虚拟磁盘模式只支持 .BIN 文件');
    return;
  }
  if (!file.size || file.size > VIRTUAL_DISK_MAX_FIRMWARE_BYTES) {
    setVirtualDiskStatus(`BIN 太大，当前虚拟磁盘可用上限约 ${formatBytes(VIRTUAL_DISK_MAX_FIRMWARE_BYTES)}`);
    return;
  }
  pendingVirtualDiskFile = file;
  virtualDiskFileName.textContent = `${file.name} · 等待 ${VIRTUAL_DISK_VOLUME_NAME}`;
  setVirtualDiskStatus(`已选择 ${file.name}，进入 ${VIRTUAL_DISK_VOLUME_NAME} 后自动写入`);
}

async function loadVirtualDiskFile(file) {
  if (!file || virtualDiskBusy) return;
  if (!virtualDiskHandle || !virtualDiskReady) {
    queueVirtualDiskFile(file);
    return;
  }
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.bin')) {
    setVirtualDiskStatus('虚拟磁盘模式只支持 .BIN 文件');
    return;
  }
  if (!file.size || file.size > VIRTUAL_DISK_MAX_FIRMWARE_BYTES) {
    setVirtualDiskStatus(`BIN 太大，当前虚拟磁盘可用上限约 ${formatBytes(VIRTUAL_DISK_MAX_FIRMWARE_BYTES)}`);
    return;
  }

  virtualDiskBusy = true;
  virtualDiskDropZone.classList.add('is-busy');
  virtualDiskProgress.hidden = false;
  virtualDiskProgress.value = 0;
  virtualDiskFileName.textContent = `${file.name} → ${VIRTUAL_DISK_FIRMWARE_NAME} · ${formatBytes(file.size)}`;
  setVirtualDiskStatus('正在读取并检查应用 BIN…');

  let writable;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateVirtualDiskImage(bytes);
    const info = await inspectVirtualDisk(virtualDiskHandle);
    const existingBins = virtualDiskBinNames(info.entries);
    const conflictingBins = existingBins.filter((name) => normalizeVolumeName(name) !== VIRTUAL_DISK_FIRMWARE_NAME);
    if (conflictingBins.length) {
      throw new Error(`磁盘内已有其他 BIN：${conflictingBins.join(', ')}；请先移除，避免 bootloader 选错文件`);
    }

    const target = await virtualDiskHandle.getFileHandle(VIRTUAL_DISK_FIRMWARE_NAME, { create: true });
    writable = await target.createWritable();
    const chunkSize = 64 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.slice(offset, Math.min(offset + chunkSize, bytes.length));
      await writable.write(chunk);
      virtualDiskProgress.value = Math.round(((offset + chunk.length) / bytes.length) * 100);
      setVirtualDiskStatus(`正在写入 ${VIRTUAL_DISK_FIRMWARE_NAME}：${virtualDiskProgress.value}%`);
    }
    await writable.close();
    writable = undefined;
    setVirtualDiskStatus('固件已写入，等待设备自动退出虚拟磁盘…');

    const gone = await waitForVirtualDiskExit(virtualDiskHandle);
    if (gone) {
      virtualDiskReady = false;
      setVirtualDiskReady(false);
      setVirtualDiskBindingPrompt(false);
      virtualDiskModeToggle.checked = false;
      virtualDiskFileName.textContent = '设备已退出 GOHO UPDATE';
      setVirtualDiskStatus('设备已退出，正在写入 Flash 并自动重启');
    } else {
      setVirtualDiskStatus('已写入，但暂未检测到磁盘退出；请检查设备状态');
    }
  } catch (error) {
    if (writable) {
      try { await writable.abort(); } catch { /* the disk may have disappeared */ }
    }
    if (isDiskGoneError(error)) {
      virtualDiskReady = false;
      setVirtualDiskReady(false);
      setVirtualDiskBindingPrompt(false);
      virtualDiskFileName.textContent = '设备已退出 GOHO UPDATE';
      setVirtualDiskStatus('设备已退出，未能确认本次写入结果');
    } else {
      setVirtualDiskStatus(`虚拟磁盘烧录失败：${error.message || error}`);
    }
    virtualDiskProgress.value = 0;
  } finally {
    virtualDiskBusy = false;
    virtualDiskDropZone.classList.remove('is-busy', 'is-over');
    setVirtualDiskReady(virtualDiskReady);
    updateVirtualDiskModeToggle();
  }
}

async function virtualDiskIsMounted(directoryHandle) {
  try {
    const entries = await readDirectoryEntries(directoryHandle);
    const readme = entries.find(({ name, handle }) => handle.kind === 'file' && isReadmeName(name));
    if (readme) await readme.handle.getFile();
    return true;
  } catch (error) {
    if (isDiskGoneError(error)) return false;
    throw error;
  }
}

async function waitForVirtualDiskExit(directoryHandle) {
  const token = ++virtualDiskPollToken;
  const started = Date.now();
  while (token === virtualDiskPollToken && Date.now() - started < VIRTUAL_DISK_POLL_TIMEOUT_MS) {
    await sleep(VIRTUAL_DISK_POLL_INTERVAL_MS);
    if (token !== virtualDiskPollToken) return false;
    if (!await virtualDiskIsMounted(directoryHandle)) return true;
    const elapsed = Math.round((Date.now() - started) / 1000);
    setVirtualDiskStatus(`固件已写入，等待设备自动退出… ${elapsed}s`);
  }
  return false;
}

async function sendVirtualDiskCommand() {
  if (!serialWriter || !serialPort) throw new Error('CDC 串口尚未连接');
  // Ask while the button/switch click still has user activation, if the
  // remembered directory permission has not survived the previous session.
  if (virtualDiskHandle && !await requestVirtualDiskPermission(virtualDiskHandle, { request: true })) {
    throw new Error(`没有获得 ${VIRTUAL_DISK_VOLUME_NAME} 的读写权限`);
  }
  const bytes = new TextEncoder().encode(`${VIRTUAL_DISK_COMMAND}\r\n`);
  await serialWriter.write(bytes);
  addBytes('>', bytes);
  addMessage(`已发送 XXX，自动寻找 ${VIRTUAL_DISK_VOLUME_NAME}`);
  if (!virtualDiskHandle) {
    setVirtualDiskStatus(`设备正在进入 ${VIRTUAL_DISK_VOLUME_NAME}；首次使用请绑定一次设备`);
    setVirtualDiskBindingPrompt(true);
    return false;
  }
  setVirtualDiskReady(false);
  const mounted = await waitForVirtualDiskMount();
  if (!mounted) {
    setVirtualDiskStatus(`未检测到 ${VIRTUAL_DISK_VOLUME_NAME}；请确认设备已重启并连接`);
  }
  return mounted;
}

virtualDiskModeToggle.addEventListener('change', async () => {
  if (!virtualDiskModeToggle.checked) return;
  virtualDiskModeToggle.disabled = true;
  setVirtualDiskStatus('正在通过 CDC 发送 XXX…');
  try {
    await sendVirtualDiskCommand();
  } catch (error) {
    virtualDiskModeToggle.checked = false;
    setVirtualDiskStatus(`进入虚拟磁盘失败：${error.message || error}`);
  } finally {
    updateVirtualDiskModeToggle();
  }
});
virtualDiskButton.addEventListener('click', chooseVirtualDisk);
virtualDiskFile.addEventListener('change', () => {
  const file = virtualDiskFile.files?.[0];
  virtualDiskFile.value = '';
  void loadVirtualDiskFile(file);
});
virtualDiskDropZone.addEventListener('click', () => {
  if (!virtualDiskBusy) virtualDiskFile.click();
});
virtualDiskDropZone.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && !virtualDiskBusy) {
    event.preventDefault();
    virtualDiskFile.click();
  }
});
['dragenter', 'dragover'].forEach((eventName) => {
  virtualDiskDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!virtualDiskBusy) virtualDiskDropZone.classList.add('is-over');
  });
});
virtualDiskDropZone.addEventListener('dragleave', () => virtualDiskDropZone.classList.remove('is-over'));
virtualDiskDropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  virtualDiskDropZone.classList.remove('is-over');
  if (virtualDiskBusy) return;
  void loadVirtualDiskFile(event.dataTransfer?.files?.[0]);
});
void restoreRememberedVirtualDisk();

function setAudioStatus(message) {
  audioStatus.textContent = message;
}

function updateAudioControls() {
  const running = Boolean(audioStream && audioContext && audioContext.state !== 'closed');
  audioRefreshButton.disabled = running;
  audioInputSelect.disabled = running || !audioInputDevices.length;
  audioStartButton.disabled = running || !audioInputSelect.value;
  audioStopButton.disabled = !running;
}

function audioDeviceLabel(device, index) {
  return device.label || `USB Audio 输入 ${index + 1}`;
}

async function enumerateAudioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    setAudioStatus(browserMessage('Web Audio / MediaDevices'));
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput');
}

async function scanAudioInputs() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setAudioStatus(browserMessage('Web Audio / getUserMedia'));
    return;
  }
  audioRefreshButton.disabled = true;
  setAudioStatus('请在浏览器权限窗口中允许音频输入…');
  let permissionStream;
  try {
    // A first capture grants the browser permission needed for device labels and
    // for selecting a non-default USB Audio input below.
    permissionStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    audioInputDevices = await enumerateAudioInputs();
    audioInputSelect.replaceChildren();
    audioInputDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = audioDeviceLabel(device, index);
      audioInputSelect.append(option);
    });
    if (!audioInputDevices.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '没有检测到音频输入';
      audioInputSelect.append(option);
      setAudioStatus('没有检测到 USB Audio 输入，请确认模块已经被系统识别');
    } else {
      setAudioStatus(`检测到 ${audioInputDevices.length} 个音频输入 · 请选择模块后开始监听`);
    }
  } catch (error) {
    audioInputDevices = [];
    audioInputSelect.replaceChildren(new Option('请先授权并扫描设备', ''));
    const reason = error.name === 'NotAllowedError'
      ? '浏览器或 macOS 没有允许音频输入权限'
      : error.name === 'NotFoundError'
        ? '没有找到音频输入设备'
        : `扫描失败：${error.message || error}`;
    setAudioStatus(reason);
  } finally {
    permissionStream?.getTracks().forEach((track) => track.stop());
    updateAudioControls();
  }
}

async function stopUsbAudioMonitor() {
  audioSource?.disconnect();
  audioGain?.disconnect();
  audioSource = undefined;
  audioGain = undefined;
  audioStream?.getTracks().forEach((track) => track.stop());
  audioStream = undefined;
  if (audioContext) {
    try { await audioContext.close(); } catch { /* already closed */ }
    audioContext = undefined;
  }
  updateAudioControls();
  setAudioStatus('监听已停止 · 输出到电脑默认声音设备');
}

async function startUsbAudioMonitor() {
  const deviceId = audioInputSelect.value;
  if (!deviceId) {
    setAudioStatus('请先扫描并选择 USB Audio 输入');
    return;
  }
  audioStartButton.disabled = true;
  setAudioStatus('正在打开 USB Audio 输入…');
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48000 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    audioContext = new AudioContext({ latencyHint: 'interactive' });
    await audioContext.resume();
    audioSource = audioContext.createMediaStreamSource(audioStream);
    audioGain = audioContext.createGain();
    audioGain.gain.value = Number(audioVolume.value) / 100;
    audioSource.connect(audioGain);
    audioGain.connect(audioContext.destination);
    audioStream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (audioStream) void stopUsbAudioMonitor();
      }, { once: true });
    });
    const settings = audioStream.getAudioTracks()[0]?.getSettings?.() || {};
    const rate = settings.sampleRate ? ` · ${settings.sampleRate} Hz` : '';
    setAudioStatus(`正在监听：${audioInputSelect.selectedOptions[0]?.textContent || 'USB Audio'}${rate} · 输出到电脑默认声音设备`);
  } catch (error) {
    await stopUsbAudioMonitor();
    setAudioStatus(`打开 USB Audio 失败：${error.message || error}`);
  } finally {
    updateAudioControls();
  }
}

audioRefreshButton.addEventListener('click', () => void scanAudioInputs());
audioStartButton.addEventListener('click', () => void startUsbAudioMonitor());
audioStopButton.addEventListener('click', () => void stopUsbAudioMonitor());
audioInputSelect.addEventListener('change', () => {
  if (!audioStream) updateAudioControls();
});
audioVolume.addEventListener('input', () => {
  audioVolumeValue.textContent = `${audioVolume.value}%`;
  if (audioGain) audioGain.gain.value = Number(audioVolume.value) / 100;
});
if (navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (!audioStream) void enumerateAudioInputs().then((devices) => {
      audioInputDevices = devices;
      updateAudioControls();
    }).catch(() => {});
  });
}
updateAudioControls();

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
    if (!serialPort?.readable) updateVirtualDiskModeToggle();
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

function serialPortUsbId(port) {
  const info = port.getInfo();
  return info.usbVendorId && info.usbProductId
    ? `${info.usbVendorId.toString(16).padStart(4, '0')}:${info.usbProductId.toString(16).padStart(4, '0')}`
    : '';
}

async function findAuthorizedGohoSerialPort() {
  const ports = await navigator.serial.getPorts();
  let usbDevices = [];
  if ('usb' in navigator) {
    try { usbDevices = await navigator.usb.getDevices(); } catch { /* WebUSB permission is optional. */ }
  }
  const matches = ports.filter((port) => {
    const info = port.getInfo();
    const usbDevice = usbDevices.find((device) => (
      device.vendorId === info.usbVendorId && device.productId === info.usbProductId
    ));
    const usbName = `${usbDevice?.manufacturerName || ''} ${usbDevice?.productName || ''}`;
    const hasGohoName = /GOHO/i.test(usbName);
    const hasGohoId = info.usbVendorId === GOHO_USB_VENDOR_ID && info.usbProductId === GOHO_USB_PRODUCT_ID;
    return hasGohoName || hasGohoId;
  });
  return matches[0];
}

async function closeCurrentSerialPort() {
  await stopReading();
  if (serialWriter) {
    try { serialWriter.releaseLock(); } catch { /* already released */ }
    serialWriter = undefined;
  }
  if (serialPort) {
    try { await serialPort.close(); } catch { /* device may already be disconnected */ }
    serialPort = undefined;
  }
}

async function connectGohoSerialAutomatically() {
  if (!('serial' in navigator)) throw new Error(browserMessage('Web Serial'));
  let port = await findAuthorizedGohoSerialPort();
  if (!port) {
    // The browser requires one user-approved chooser the first time. The
    // filter keeps the chooser limited to the GOHO CDC VID/PID.
    port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: GOHO_USB_VENDOR_ID, usbProductId: GOHO_USB_PRODUCT_ID }],
    });
  }
  if (serialPort === port && serialWriter && serialPort.readable) return serialPort;
  if (serialPort) await closeCurrentSerialPort();
  serialPort = port;
  if (!serialPort.readable) await serialPort.open({ baudRate: Number(baudRate.value) });
  serialWriter = serialPort.writable.getWriter();
  monitorPanel.hidden = false;
  serialButton.textContent = '断开串口';
  const usbId = serialPortUsbId(serialPort);
  serialStatus.textContent = `已自动连接：${portName(serialPort)}${usbId ? ` · USB ${usbId}` : ''}，等待数据`;
  updateVirtualDiskModeToggle();
  addMessage(`自动连接 GOHO CDC：${portName(serialPort)}${usbId ? ` · USB ${usbId}` : ''}`);
  readSerial();
  return serialPort;
}

enterVirtualDiskButton.addEventListener('click', async () => {
  enterVirtualDiskButton.disabled = true;
  setVirtualDiskStatus('正在自动寻找名称含 GOHO 的 CDC 设备…');
  try {
    await connectGohoSerialAutomatically();
    await sendVirtualDiskCommand();
  } catch (error) {
    setVirtualDiskStatus(error.name === 'NotFoundError'
      ? '未找到 GOHO CDC 设备；首次使用请在浏览器授权窗口中选择它'
      : `一键进入失败：${error.message || error}`);
  } finally {
    enterVirtualDiskButton.disabled = false;
    updateVirtualDiskModeToggle();
  }
});

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
      updateVirtualDiskModeToggle();
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
    updateVirtualDiskModeToggle();
    addMessage(`串口已连接：${portName(serialPort)}${usbId}，波特率 ${baudRate.value}`);
    readSerial();
  } catch (error) {
    serialStatus.textContent = error.name === 'NotFoundError' ? '未选择设备' : `连接失败：${error.message}`;
    serialPort = undefined;
    serialWriter = undefined;
    updateVirtualDiskModeToggle();
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
  const backgroundCanvas = document.querySelector('#backgroundCanvas');
  const backgroundContext = backgroundCanvas?.getContext('2d');
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
    if (backgroundCanvas) {
      backgroundCanvas.width = Math.floor(width * ratio);
      backgroundCanvas.height = Math.floor(height * ratio);
      backgroundCanvas.style.width = `${width}px`;
      backgroundCanvas.style.height = `${height}px`;
      backgroundContext?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    projection = perspective(Math.PI / 3.4, width / height, .1, 500);
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

  function draw2DBackground(time) {
    if (!backgroundContext) return;
    backgroundContext.clearRect(0, 0, width, height);
    const gradient = backgroundContext.createRadialGradient(width * .5, height * .46, 0, width * .5, height * .46, Math.max(width, height) * .72);
    gradient.addColorStop(0, '#10143a');
    gradient.addColorStop(.48, '#080b21');
    gradient.addColorStop(1, '#03040b');
    backgroundContext.fillStyle = gradient;
    backgroundContext.fillRect(0, 0, width, height);

    const nebula = backgroundContext.createRadialGradient(width * .28, height * .62, 0, width * .28, height * .62, width * .32);
    nebula.addColorStop(0, 'rgba(105, 77, 255, .18)');
    nebula.addColorStop(1, 'rgba(105, 77, 255, 0)');
    backgroundContext.fillStyle = nebula;
    backgroundContext.fillRect(0, 0, width, height);

    const driftX = yaw * width * .035;
    const driftY = pitch * height * .035;
    for (let index = 0; index < 900; index += 1) {
      const x = ((index * 83.17 + driftX) % (width + 40) + width + 40) % (width + 40) - 20;
      const y = ((index * 47.91 + driftY) % (height + 40) + height + 40) % (height + 40) - 20;
      const size = 0.35 + ((index * 17) % 100) / 150;
      const alpha = .18 + ((index * 29) % 100) / 170;
      const color = index % 19 === 0 ? `rgba(119, 231, 255, ${alpha})` : index % 23 === 0 ? `rgba(251, 141, 202, ${alpha})` : `rgba(220, 226, 255, ${alpha})`;
      backgroundContext.fillStyle = color;
      backgroundContext.beginPath();
      backgroundContext.arc(x, y, size, 0, Math.PI * 2);
      backgroundContext.fill();
    }
    backgroundContext.fillStyle = 'rgba(255, 255, 255, .055)';
    backgroundContext.fillRect(0, height * .5, width, 1);
    void time;
  }

  function render(time) {
    draw2DBackground(time);
    updateCamera();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

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
    yaw += dx * .0045;
    pitch = Math.max(-Math.PI / 2 + .08, Math.min(Math.PI / 2 - .08, pitch + dy * .0045));
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
