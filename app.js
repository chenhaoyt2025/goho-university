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
const enterVirtualDiskButton = document.querySelector('#enterVirtualDiskButton');
const audioRefreshButton = document.querySelector('#audioRefreshButton');
const audioInputSelect = document.querySelector('#audioInputSelect');
const audioOutputSelect = document.querySelector('#audioOutputSelect');
const audioChannelSummary = document.querySelector('#audioChannelSummary');
const audioMonoChannelSelect = document.querySelector('#audioMonoChannelSelect');
const audioStereoChannelSelect = document.querySelector('#audioStereoChannelSelect');
const audioMuteButton = document.querySelector('#audioMuteButton');
const audioVolume = document.querySelector('#audioVolume');
const audioVolumeValue = document.querySelector('#audioVolumeValue');
const audioModeButtons = Array.from(document.querySelectorAll('[data-audio-command]'));
const audioRevSlider = document.querySelector('#audioRevSlider');
const audioRevValue = document.querySelector('#audioRevValue');
const audioStatus = document.querySelector('#audioStatus');
const bleMidiConnectButton = document.querySelector('#bleMidiConnectButton');
const bleMidiDisconnectButton = document.querySelector('#bleMidiDisconnectButton');
const bleMidiDeviceName = document.querySelector('#bleMidiDeviceName');
const espWifiScanButton = document.querySelector('#espWifiScanButton');
const espWifiNetworkSelect = document.querySelector('#espWifiNetworkSelect');
const espWifiPassword = document.querySelector('#espWifiPassword');
const espWifiSaveButton = document.querySelector('#espWifiSaveButton');
const espWifiStatus = document.querySelector('#espWifiStatus');
const linkNetworkState = document.querySelector('#linkNetworkState');
const linkPeerCount = document.querySelector('#linkPeerCount');
const linkPlayState = document.querySelector('#linkPlayState');
const linkEnableButton = document.querySelector('#linkEnableButton');
const linkTempoValue = document.querySelector('#linkTempoValue');
const linkPlayButton = document.querySelector('#linkPlayButton');
const linkStopButton = document.querySelector('#linkStopButton');
const linkMetronomeButton = document.querySelector('#linkMetronomeButton');
const linkTempoSlider = document.querySelector('#linkTempoSlider');
const linkTempoSliderValue = document.querySelector('#linkTempoSliderValue');
const linkBeatGrid = document.querySelector('#linkBeatGrid');
const bleLinkStatus = document.querySelector('#bleLinkStatus');
const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));
const worldTabs = Object.freeze({
  tools: 'update',
  eurorack: 'update',
  satellite: 'update',
  fx: 'usb',
  vst: 'usb',
  max: 'ble',
  macos: 'ble',
  neutron: 'ble',
});

function activateTab(name) {
  const target = tabButtons.some((button) => button.dataset.tabTarget === name) ? name : 'update';
  tabButtons.forEach((button) => {
    const active = button.dataset.tabTarget === target;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  tabPanels.forEach((panel) => {
    const active = panel.dataset.tabPanel === target;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
  document.body.dataset.activeTab = target;
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tabTarget));
});
activateTab('update');

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
const BLE_MIDI_SERVICE_UUID = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const BLE_MIDI_CHARACTERISTIC_UUID = '7772e5db-3868-4112-a1a9-f2669d106bf3';
const LINK_BRIDGE_CHARACTERISTIC_UUID = '9c5d3f2a-0d8e-4a0f-9a5d-4f7e9b0c22a1';
const LINK_BRIDGE_STATUS_MAGIC = 0xa1;
const LINK_TEMPO_MIN = 30;
const LINK_TEMPO_MAX = 300;

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
let audioOutputDevices = [];
let audioChannelInfo = new Map();
let audioProbeToken = 0;
let audioRevSendTimer;
let audioSourceMode = 'OFF';
let audioStream;
let audioContext;
let audioSource;
let audioSplitter;
let audioMerger;
let audioGain;
let audioMuted = false;
let audioRoutingToken = 0;
let bleMidiDevice;
let bleMidiServer;
let bleMidiCharacteristic;
let linkBridgeCharacteristic;
let linkTempo = 120;
let linkPlaying = false;
let linkMetronomeEnabled = false;
let linkBeatIndex = 0;
let linkBeatTimer;
let linkAudioContext;
let linkLastClockTime = 0;
let linkClockPulses = 0;
let linkClockIntervals = [];
let bleMidiClockTimer;
let bleMidiClockToken = 0;
let bleMidiClockRunning = false;
let bleMidiClockNextDue = 0;
let bleMidiClockPulseCount = 0;
let bleMidiClockWriteChain = Promise.resolve();
let linkDeviceState = { enabled: false, wifi: false, playing: false, peers: 0, tempo: 120, phase: 0 };
let espWifiState = { configured: false, started: false, connected: false, ssid: '', ip: '' };
let espWifiNetworks = [];
let espWifiScanExpected = 0;
let linkLastDeviceBeat = -1;

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

async function chooseVirtualDiskFirmwareFile() {
  if (virtualDiskBusy) return;
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        id: 'goho-update-firmware',
        multiple: false,
        excludeAcceptAllOption: true,
        types: [{
          description: 'BIN 固件',
          accept: { 'application/octet-stream': ['.bin'] },
        }],
      });
      await loadVirtualDiskFile(await fileHandle.getFile());
    } catch (error) {
      if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') {
        setVirtualDiskStatus(`选择 BIN 失败：${error.message || error}`);
      }
    }
    return;
  }
  virtualDiskFile.click();
}

virtualDiskButton.addEventListener('click', chooseVirtualDisk);
virtualDiskFile.addEventListener('change', () => {
  const file = virtualDiskFile.files?.[0];
  virtualDiskFile.value = '';
  void loadVirtualDiskFile(file);
});
virtualDiskDropZone.addEventListener('click', () => {
  if (!virtualDiskBusy) void chooseVirtualDiskFirmwareFile();
});
virtualDiskDropZone.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && !virtualDiskBusy) {
    event.preventDefault();
    void chooseVirtualDiskFirmwareFile();
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

function audioChannelRange(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  return Number.isFinite(value.max) ? value.max : Number.isFinite(value.min) ? value.min : 0;
}

function selectedAudioChannelInfo() {
  return audioChannelInfo.get(audioInputSelect.value);
}

function audioDeviceLabel(device, index) {
  const info = audioChannelInfo.get(device.deviceId);
  const channels = info?.availableChannels ? ` · input ${info.availableChannels}ch` : '';
  return `${device.label || `USB Audio 输入 ${index + 1}`}${channels}`;
}

function audioOutputDeviceLabel(device, index) {
  return device.label || `声音输出设备 ${index + 1}`;
}

function selectedAudioOutputLabel() {
  return audioOutputSelect.value
    ? (audioOutputSelect.selectedOptions[0]?.textContent || '其他声音设备')
    : '系统默认声音设备';
}

function renderAudioOutputDevices() {
  const previous = audioOutputSelect.value;
  audioOutputSelect.replaceChildren(new Option('系统默认声音设备', ''));
  audioOutputDevices.forEach((device, index) => {
    audioOutputSelect.append(new Option(audioOutputDeviceLabel(device, index), device.deviceId));
  });
  if (audioOutputDevices.some((device) => device.deviceId === previous)) {
    audioOutputSelect.value = previous;
  } else {
    audioOutputSelect.value = '';
  }
}

function updateAudioDeviceLabels() {
  Array.from(audioInputSelect.options).forEach((option, index) => {
    const device = audioInputDevices[index];
    if (device) option.textContent = audioDeviceLabel(device, index);
  });
}

function animateAudioWheel(select) {
  select.classList.remove('is-spinning');
  void select.offsetWidth;
  select.classList.add('is-spinning');
}

function updateAudioWheelState() {
  const hasChannels = Boolean(selectedAudioChannelInfo()?.availableChannels);
  const monoSelected = Boolean(audioMonoChannelSelect.value);
  const stereoSelected = Boolean(audioStereoChannelSelect.value);
  const baseDisabled = !hasChannels;

  if (monoSelected) {
    audioStereoChannelSelect.value = '';
  } else if (stereoSelected) {
    audioMonoChannelSelect.value = '';
  }

  audioMonoChannelSelect.disabled = baseDisabled || stereoSelected;
  audioStereoChannelSelect.disabled = baseDisabled || monoSelected;
  audioMonoChannelSelect.closest('.audio-wheel-group')?.classList.toggle('is-disabled', audioMonoChannelSelect.disabled);
  audioStereoChannelSelect.closest('.audio-wheel-group')?.classList.toggle('is-disabled', audioStereoChannelSelect.disabled);
}

function updateAudioChannelOptions() {
  const info = selectedAudioChannelInfo();
  const channelCount = info?.availableChannels || 0;
  const previousMono = audioMonoChannelSelect.value;
  const previousStereo = audioStereoChannelSelect.value;

  audioMonoChannelSelect.replaceChildren(new Option('OFF', ''));
  audioStereoChannelSelect.replaceChildren(new Option('OFF', ''));
  if (!channelCount) {
    updateAudioWheelState();
    return;
  }

  for (let channel = 1; channel <= channelCount; channel += 1) {
    audioMonoChannelSelect.append(new Option(`${channel}`, String(channel - 1)));
  }
  for (let first = 1; first + 1 <= channelCount; first += 2) {
    audioStereoChannelSelect.append(new Option(`${first}-${first + 1}`, String(first - 1)));
  }

  if (Array.from(audioMonoChannelSelect.options).some((option) => option.value === previousMono)) {
    audioMonoChannelSelect.value = previousMono;
  }
  if (Array.from(audioStereoChannelSelect.options).some((option) => option.value === previousStereo)) {
    audioStereoChannelSelect.value = previousStereo;
  }
  updateAudioWheelState();
}

function applyAudioGain() {
  if (audioGain) audioGain.gain.value = audioMuted ? 0 : Number(audioVolume.value) / 100;
}

function updateAudioMuteButton() {
  audioMuteButton.classList.toggle('is-muted', audioMuted);
  audioMuteButton.setAttribute('aria-pressed', String(audioMuted));
}

function updateAudioControls() {
  const running = Boolean(audioStream && audioContext && audioContext.state !== 'closed');
  audioRefreshButton.disabled = running;
  audioInputSelect.disabled = running || !audioInputDevices.length;
  audioOutputSelect.disabled = !audioInputDevices.length;
  updateAudioWheelState();
  updateAudioModeButtons();
  audioMuteButton.disabled = !running;
  updateAudioMuteButton();
}

function audioTrackInfo(track) {
  const settings = track.getSettings?.() || {};
  const capabilities = track.getCapabilities?.() || {};
  const actualChannels = Number(settings.channelCount) || 0;
  const maxChannels = audioChannelRange(capabilities.channelCount);
  return {
    actualChannels,
    maxChannels,
    availableChannels: Math.max(actualChannels, maxChannels, 1),
    sampleRate: Number(settings.sampleRate) || 0,
  };
}

function getAudioContextConstructor() {
  return window.AudioContext || window.webkitAudioContext;
}

async function getAudioInputStream(deviceId, channelCount = 2) {
  const base = {
    deviceId: { exact: deviceId },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { ...base, channelCount: { exact: channelCount } },
    });
  } catch (error) {
    if (channelCount <= 2) throw error;
    return navigator.mediaDevices.getUserMedia({
      audio: { ...base, channelCount: { ideal: channelCount } },
    });
  }
}

async function enumerateAudioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    setAudioStatus(browserMessage('Web Audio / MediaDevices'));
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput');
}

async function enumerateAudioOutputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audiooutput' && device.deviceId !== 'default');
}

async function refreshAudioOutputs() {
  try {
    audioOutputDevices = await enumerateAudioOutputs();
    renderAudioOutputDevices();
    updateAudioControls();
  } catch {
    audioOutputDevices = [];
    renderAudioOutputDevices();
  }
}

async function probeAudioInput(deviceId) {
  if (!deviceId || !navigator.mediaDevices?.getUserMedia) return;
  const token = ++audioProbeToken;
  setAudioStatus('正在检测所选声卡的输入通道…');
  audioChannelSummary.textContent = `输入通道：检测中 · 输出：${selectedAudioOutputLabel()} 2ch`;
  updateAudioControls();
  let probeStream;
  try {
    // Request a wide channel layout once. The browser reports the actual and
    // maximum channel count through the track settings/capabilities.
    probeStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        channelCount: { ideal: 32 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const track = probeStream.getAudioTracks()[0];
    const info = track ? audioTrackInfo(track) : undefined;
    if (!info || token !== audioProbeToken) return;
    audioChannelInfo.set(deviceId, info);
    updateAudioDeviceLabels();
    updateAudioChannelOptions();
    const actual = info.actualChannels || info.availableChannels;
    const max = info.maxChannels && info.maxChannels !== actual ? `，浏览器上限 ${info.maxChannels}ch` : '';
    audioChannelSummary.textContent = `输入通道：${actual}ch${max} · 输出：${selectedAudioOutputLabel()} 2ch`;
    setAudioStatus(`${audioInputSelect.selectedOptions[0]?.textContent || 'USB Audio'} · ${info.availableChannels}ch · 选择 MONO 或 STEREO`);
  } catch (error) {
    if (token === audioProbeToken) {
      audioChannelInfo.delete(deviceId);
      updateAudioChannelOptions();
      audioChannelSummary.textContent = `输入通道：检测失败 · 输出：${selectedAudioOutputLabel()} 2ch`;
      setAudioStatus(`通道检测失败：${error.message || error}`);
    }
  } finally {
    probeStream?.getTracks().forEach((track) => track.stop());
    if (token === audioProbeToken) updateAudioControls();
  }
}

async function setAudioOutputDevice(deviceId = audioOutputSelect.value) {
  if (!audioContext || typeof audioContext.setSinkId !== 'function') {
    if (deviceId) throw new Error('当前浏览器不支持选择声音输出设备');
    return;
  }
  await audioContext.setSinkId(deviceId || '');
}

function updateAudioModeButtons() {
  audioModeButtons.forEach((button) => {
    const active = button.dataset.audioCommand === audioSourceMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function sendUsbAudioCommand(command) {
  if (!('serial' in navigator)) throw new Error(browserMessage('Web Serial'));
  if (!serialWriter) await connectGohoSerialAutomatically();
  if (!serialWriter) throw new Error('GOHO CDC 串口尚未连接');
  const bytes = new TextEncoder().encode(`${command}\r\n`);
  await serialWriter.write(bytes);
  addBytes('>', bytes);
  if (/^(USB|LINE|SYNTH|OFF)$/.test(command)) {
    audioSourceMode = command;
    if (command === 'OFF') {
      audioRevSlider.value = '0';
      audioRevValue.textContent = '0';
    }
    updateAudioModeButtons();
  }
  setAudioStatus(`已发送 ${command} · ${serialPort ? portName(serialPort) : 'GOHO CDC'}`);
}

function queueAudioReverbCommand(immediate = false) {
  const value = Math.max(0, Math.min(100, Number(audioRevSlider.value) || 0));
  audioRevValue.textContent = String(value);
  clearTimeout(audioRevSendTimer);
  const send = () => void sendUsbAudioCommand(`REV ${value}`).catch((error) => {
    setAudioStatus(`REV 发送失败：${error.message || error}`);
  });
  if (immediate) send();
  else audioRevSendTimer = setTimeout(send, 100);
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
    permissionStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    audioInputDevices = await enumerateAudioInputs();
    audioOutputDevices = await enumerateAudioOutputs();
    audioChannelInfo.clear();
    renderAudioOutputDevices();
    audioInputSelect.replaceChildren();
    audioInputDevices.forEach((device, index) => {
      audioInputSelect.append(new Option(audioDeviceLabel(device, index), device.deviceId));
    });
    if (!audioInputDevices.length) {
      audioInputSelect.append(new Option('没有检测到音频输入', ''));
      setAudioStatus('没有检测到 USB Audio 输入，请确认模块已经被系统识别');
    } else {
      setAudioStatus(`检测到 ${audioInputDevices.length} 个音频输入 · 请选择模块后检测通道`);
      void probeAudioInput(audioInputSelect.value);
    }
  } catch (error) {
    audioInputDevices = [];
    audioChannelInfo.clear();
    audioInputSelect.replaceChildren(new Option('请先授权并扫描设备', ''));
    const reason = error.name === 'NotAllowedError'
      ? '浏览器或 macOS 没有允许音频输入权限'
      : error.name === 'NotFoundError'
        ? '没有找到音频输入设备'
        : `扫描失败：${error.message || error}`;
    setAudioStatus(reason);
  } finally {
    permissionStream?.getTracks().forEach((track) => track.stop());
    updateAudioChannelOptions();
    updateAudioControls();
  }
}

async function stopUsbAudioMonitor() {
  audioSource?.disconnect();
  audioSplitter?.disconnect();
  audioMerger?.disconnect();
  audioGain?.disconnect();
  audioSource = undefined;
  audioSplitter = undefined;
  audioMerger = undefined;
  audioGain = undefined;
  audioStream?.getTracks().forEach((track) => track.stop());
  audioStream = undefined;
  if (audioContext) {
    try { await audioContext.close(); } catch { /* already closed */ }
    audioContext = undefined;
  }
  updateAudioControls();
  setAudioStatus(`监听已停止 · 输出 ${selectedAudioOutputLabel()} 2ch`);
}

async function startUsbAudioMonitor() {
  const deviceId = audioInputSelect.value;
  const info = selectedAudioChannelInfo();
  const monoChannel = audioMonoChannelSelect.value === '' ? null : Number(audioMonoChannelSelect.value);
  const stereoChannel = audioStereoChannelSelect.value === '' ? null : Number(audioStereoChannelSelect.value);
  const mode = monoChannel !== null ? 'mono' : stereoChannel !== null ? 'stereo' : '';
  const startChannel = mode === 'mono' ? monoChannel : stereoChannel;
  const requiredChannels = mode === 'stereo' ? startChannel + 2 : startChannel + 1;
  if (!deviceId || !info || !mode || !Number.isInteger(startChannel) || requiredChannels < 1) {
    setAudioStatus('请选择 MONO 或 STEREO 通道');
    return;
  }
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    setAudioStatus(browserMessage('Web Audio / AudioContext'));
    return;
  }
  setAudioStatus(`正在打开 ${mode === 'stereo' ? 'STEREO' : 'MONO'} ${mode === 'stereo' ? `${startChannel + 1}-${startChannel + 2}` : startChannel + 1}…`);
  try {
    const requestedChannels = Math.max(info.availableChannels, requiredChannels);
    audioStream = await getAudioInputStream(deviceId, requestedChannels);
    audioContext = new AudioContextConstructor({ latencyHint: 'interactive' });
    await setAudioOutputDevice(audioOutputSelect.value);
    await audioContext.resume();
    audioSource = audioContext.createMediaStreamSource(audioStream);
    const settings = audioStream.getAudioTracks()[0]?.getSettings?.() || {};
    const actualChannels = Math.max(Number(settings.channelCount) || 0, audioSource.channelCount || 0, info.actualChannels || 0, 2);
    if (actualChannels < requiredChannels) {
      throw new Error(`浏览器只提供 ${actualChannels} 个输入通道，无法打开所选的第 ${requiredChannels} 通道`);
    }
    audioSplitter = audioContext.createChannelSplitter(actualChannels);
    audioMerger = audioContext.createChannelMerger(2);
    audioMerger.channelCountMode = 'explicit';
    audioMerger.channelInterpretation = 'speakers';
    audioSource.connect(audioSplitter);
    if (mode === 'mono') {
      audioSplitter.connect(audioMerger, startChannel, 0);
      audioSplitter.connect(audioMerger, startChannel, 1);
    } else {
      audioSplitter.connect(audioMerger, startChannel, 0);
      audioSplitter.connect(audioMerger, startChannel + 1, 1);
    }
    audioGain = audioContext.createGain();
    applyAudioGain();
    audioMerger.connect(audioGain);
    audioGain.connect(audioContext.destination);
    audioStream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (audioStream) void stopUsbAudioMonitor();
      }, { once: true });
    });
    const rate = settings.sampleRate ? ` · ${settings.sampleRate} Hz` : '';
    const channelText = mode === 'mono' ? `MONO ${startChannel + 1}→L/R` : `STEREO ${startChannel + 1}-${startChannel + 2}→L/R`;
    audioChannelSummary.textContent = `输入 ${actualChannels}ch · ${channelText} · 输出 ${selectedAudioOutputLabel()} 2ch`;
    setAudioStatus(`正在监听：${audioInputSelect.selectedOptions[0]?.textContent || 'USB Audio'} · ${channelText} · ${selectedAudioOutputLabel()}${rate}`);
  } catch (error) {
    await stopUsbAudioMonitor();
    setAudioStatus(`打开 USB Audio 失败：${error.message || error}`);
  } finally {
    updateAudioControls();
  }
}

async function applyAudioRouting() {
  const token = ++audioRoutingToken;
  if (!audioMonoChannelSelect.value && !audioStereoChannelSelect.value) {
    if (audioStream) await stopUsbAudioMonitor();
    setAudioStatus('选择 MONO 或 STEREO 通道后自动监听');
    return;
  }
  if (audioStream) await stopUsbAudioMonitor();
  if (token !== audioRoutingToken) return;
  await startUsbAudioMonitor();
}

audioRefreshButton.addEventListener('click', () => void scanAudioInputs());
audioMuteButton.addEventListener('click', () => {
  audioMuted = !audioMuted;
  applyAudioGain();
  updateAudioMuteButton();
});
audioInputSelect.addEventListener('change', () => {
  audioChannelInfo.delete(audioInputSelect.value);
  updateAudioChannelOptions();
  void probeAudioInput(audioInputSelect.value);
});
[audioMonoChannelSelect, audioStereoChannelSelect].forEach((select) => {
  select.addEventListener('change', () => {
    animateAudioWheel(select);
    updateAudioWheelState();
    void applyAudioRouting();
  });
});
audioOutputSelect.addEventListener('change', async () => {
  try {
    await setAudioOutputDevice(audioOutputSelect.value);
    audioChannelSummary.textContent = audioChannelSummary.textContent.replace(/输出 [^·]+/, `输出 ${selectedAudioOutputLabel()}`);
    if (audioStream) setAudioStatus(`监听输出已切换：${selectedAudioOutputLabel()}`);
  } catch (error) {
    setAudioStatus(`输出设备切换失败：${error.message || error}`);
  }
});
audioModeButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    audioModeButtons.forEach((item) => { item.disabled = true; });
    try {
      await sendUsbAudioCommand(button.dataset.audioCommand);
    } catch (error) {
      setAudioStatus(`命令发送失败：${error.message || error}`);
    } finally {
      audioModeButtons.forEach((item) => { item.disabled = false; });
      updateAudioModeButtons();
    }
  });
});
audioRevSlider.addEventListener('input', () => queueAudioReverbCommand(false));
audioRevSlider.addEventListener('change', () => queueAudioReverbCommand(true));
audioVolume.addEventListener('input', () => {
  audioVolumeValue.textContent = `${audioVolume.value}%`;
  applyAudioGain();
});

if (navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (audioStream) return;
    void Promise.all([enumerateAudioInputs(), enumerateAudioOutputs()]).then(([inputs, outputs]) => {
      const previousInput = audioInputSelect.value;
      audioInputDevices = inputs;
      audioOutputDevices = outputs;
      audioInputSelect.replaceChildren();
      audioInputDevices.forEach((device, index) => {
        audioInputSelect.append(new Option(audioDeviceLabel(device, index), device.deviceId));
      });
      if (audioInputDevices.some((device) => device.deviceId === previousInput)) {
        audioInputSelect.value = previousInput;
      }
      renderAudioOutputDevices();
      updateAudioChannelOptions();
      updateAudioControls();
    }).catch(() => {});
  });
}
updateAudioChannelOptions();
renderAudioOutputDevices();
updateAudioControls();


function setBleLinkStatus(message) {
  bleLinkStatus.textContent = message;
}

function updateLinkUi() {
  const connected = Boolean(bleMidiCharacteristic);
  const bridgeReady = Boolean(linkBridgeCharacteristic);
  const linkEnabled = bridgeReady && linkDeviceState.enabled;
  const networkState = !connected
    ? 'OFFLINE'
    : !bridgeReady
      ? 'BLE MIDI'
      : linkEnabled
        ? (linkDeviceState.wifi ? 'LINK' : 'WAIT WIFI')
        : 'OFF';

  linkNetworkState.textContent = networkState;
  linkPeerCount.textContent = bridgeReady && linkEnabled ? String(linkDeviceState.peers) : '—';
  linkPlayState.textContent = linkPlaying ? 'PLAYING' : 'STOPPED';
  linkTempoValue.textContent = String(Math.round(linkTempo));
  linkTempoSliderValue.textContent = String(Math.round(linkTempo));
  linkTempoSlider.value = String(Math.round(linkTempo));
  bleMidiConnectButton.disabled = connected;
  bleMidiDisconnectButton.disabled = !connected;
  linkEnableButton.disabled = !connected;
  linkEnableButton.textContent = bridgeReady && linkDeviceState.enabled ? 'LINK ON' : 'LINK OFF';
  linkEnableButton.classList.toggle('is-active', bridgeReady && linkDeviceState.enabled);
  linkPlayButton.disabled = !connected;
  linkStopButton.disabled = !connected;
  linkMetronomeButton.textContent = linkMetronomeEnabled ? 'METRONOME ON' : 'METRONOME OFF';
  linkMetronomeButton.classList.toggle('is-active', linkMetronomeEnabled);
  linkMetronomeButton.setAttribute('aria-pressed', String(linkMetronomeEnabled));
  updateEspWifiUi();
}

function bleMidiTimestamp() {
  return Math.floor(performance.now()) & 0x1FFF;
}

function encodeBleMidiPacket(message) {
  const timestamp = bleMidiTimestamp();
  return Uint8Array.from([
    0x80 | ((timestamp >> 7) & 0x3F),
    0x80 | (timestamp & 0x7F),
    ...message,
  ]);
}

async function writeBleCharacteristic(characteristic, packet) {
  if (!characteristic) return false;
  if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
    await characteristic.writeValueWithoutResponse(packet);
  } else {
    await characteristic.writeValue(packet);
  }
  return true;
}

async function sendBleMidiMessage(message) {
  if (!bleMidiCharacteristic) {
    setBleLinkStatus('请先连接 BLE MIDI');
    return false;
  }
  return writeBleCharacteristic(bleMidiCharacteristic, encodeBleMidiPacket(message));
}

function isEsp32LinkMode() {
  return Boolean(linkBridgeCharacteristic && linkDeviceState.enabled);
}

function isBleMidiClockMode() {
  return Boolean(bleMidiCharacteristic) && !isEsp32LinkMode();
}

function bleMidiClockIntervalMs() {
  const bpm = Math.max(LINK_TEMPO_MIN, Math.min(LINK_TEMPO_MAX, Number(linkTempo) || 120));
  return 60000 / (bpm * 24);
}

function enqueueBleMidiMessage(message, shouldSend = () => true) {
  const write = bleMidiClockWriteChain
    .catch(() => false)
    .then(() => {
      if (!bleMidiCharacteristic || !shouldSend()) return false;
      return writeBleCharacteristic(bleMidiCharacteristic, encodeBleMidiPacket(message));
    });
  bleMidiClockWriteChain = write.catch(() => false);
  return write;
}

function scheduleBleMidiClock(token) {
  if (token !== bleMidiClockToken || !bleMidiClockRunning || !isBleMidiClockMode()) return;

  const delay = Math.max(0, bleMidiClockNextDue - performance.now());
  bleMidiClockTimer = window.setTimeout(() => {
    if (token !== bleMidiClockToken || !bleMidiClockRunning || !isBleMidiClockMode()) return;

    const now = performance.now();
    bleMidiClockPulseCount += 1;
    if (bleMidiClockPulseCount % 24 === 0) {
      const quarterBeat = Math.floor(bleMidiClockPulseCount / 24) - 1;
      updateLinkBeat(quarterBeat % 4);
      if (linkMetronomeEnabled) playMetronomeClick(quarterBeat % 4 === 0);
    }

    void enqueueBleMidiMessage(Uint8Array.of(0xF8), () =>
      token === bleMidiClockToken && bleMidiClockRunning && isBleMidiClockMode());

    const interval = bleMidiClockIntervalMs();
    bleMidiClockNextDue += interval;
    if (bleMidiClockNextDue <= now) {
      bleMidiClockNextDue = now + interval;
    }
    scheduleBleMidiClock(token);
  }, delay);
}

async function stopBleMidiClock(sendStop = false) {
  const wasRunning = bleMidiClockRunning;
  bleMidiClockRunning = false;
  bleMidiClockToken += 1;
  if (bleMidiClockTimer) window.clearTimeout(bleMidiClockTimer);
  bleMidiClockTimer = undefined;
  bleMidiClockNextDue = 0;
  bleMidiClockPulseCount = 0;

  if (sendStop && wasRunning && bleMidiCharacteristic) {
    await enqueueBleMidiMessage(Uint8Array.of(0xFC));
  } else {
    await bleMidiClockWriteChain.catch(() => false);
  }
}

async function startBleMidiClock() {
  if (!isBleMidiClockMode()) {
    setBleLinkStatus('请先关闭 ESP32 LINK，再使用 BLE MIDI PPQN 同步');
    return false;
  }

  await stopBleMidiClock(false);
  const started = await enqueueBleMidiMessage(Uint8Array.of(0xFA));
  if (!started) return false;

  bleMidiClockRunning = true;
  bleMidiClockPulseCount = 0;
  updateLinkBeat(0);
  bleMidiClockNextDue = performance.now() + bleMidiClockIntervalMs();
  const token = bleMidiClockToken;
  scheduleBleMidiClock(token);
  return true;
}

async function sendLinkBridgeCommand(command, payload = []) {
  if (!linkBridgeCharacteristic) return false;
  return writeBleCharacteristic(linkBridgeCharacteristic, Uint8Array.from([command, ...payload]));
}

function midiMessageLength(status) {
  if (status >= 0xF8) return 1;
  if (status === 0xF1 || status === 0xF3 || status === 0xF9 || status === 0xFD) return 2;
  if (status === 0xF2) return 3;
  const type = status & 0xF0;
  if (type === 0xC0 || type === 0xD0) return 2;
  if (type >= 0x80 && type <= 0xE0) return 3;
  return 1;
}

function decodeBleMidiPacket(value) {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.length < 2 || !(bytes[0] & 0x80)) return [];
  const messages = [];
  const timestampHigh = bytes[0] & 0x3F;
  let runningStatus = 0;
  let index = 1;
  while (index < bytes.length) {
    if (!(bytes[index] & 0x80)) {
      index++;
      continue;
    }
    const timestamp = (timestampHigh << 7) | (bytes[index] & 0x7F);
    index++;
    if (index >= bytes.length) break;
    let status = bytes[index];
    if (status >= 0xF8) {
      messages.push({ timestamp, bytes: Uint8Array.of(status) });
      index++;
      continue;
    }
    if (status & 0x80) {
      runningStatus = status;
      index++;
    } else if (!runningStatus) {
      index++;
      continue;
    } else {
      status = runningStatus;
    }
    const length = midiMessageLength(status);
    const message = [status];
    while (message.length < length && index < bytes.length) {
      const byte = bytes[index];
      if (byte & 0x80) {
        if (byte >= 0xF8) {
          messages.push({ timestamp, bytes: Uint8Array.of(byte) });
          index++;
          continue;
        }
        break;
      }
      message.push(byte);
      index++;
    }
    if (message.length === length) messages.push({ timestamp, bytes: Uint8Array.from(message) });
  }
  return messages;
}

function parseUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function setEspWifiStatus(message) {
  espWifiStatus.textContent = message;
}

function updateEspWifiUi() {
  const bridgeReady = Boolean(linkBridgeCharacteristic);
  espWifiScanButton.disabled = !bridgeReady;
  espWifiNetworkSelect.disabled = !bridgeReady || !espWifiNetworks.length;
  espWifiPassword.disabled = !bridgeReady;
  espWifiSaveButton.disabled = !bridgeReady || !espWifiNetworkSelect.value;

  if (!bridgeReady) {
    setEspWifiStatus('先连接 ESP32 的 BLE MIDI');
    return;
  }
  if (espWifiState.connected) {
    setEspWifiStatus(`已连接 ${espWifiState.ssid || 'WiFi'}${espWifiState.ip ? ` · ${espWifiState.ip}` : ''}`);
  } else if (espWifiState.started) {
    setEspWifiStatus(`正在连接 ${espWifiState.ssid || 'WiFi'}…`);
  } else if (espWifiState.ssid) {
    setEspWifiStatus(`已保存 ${espWifiState.ssid} · 未连接`);
  } else {
    setEspWifiStatus('尚未配置 WiFi');
  }
}

function renderEspWifiNetworks() {
  const previousValue = espWifiNetworkSelect.value;
  espWifiNetworkSelect.replaceChildren();
  if (!espWifiNetworks.length) {
    espWifiNetworkSelect.append(new Option('先点击扫描 WiFi', ''));
  } else {
    espWifiNetworkSelect.append(new Option('选择 WiFi 网络', ''));
    espWifiNetworks.forEach(({ ssid, rssi }) => {
      const signal = Number.isFinite(rssi) ? ` · ${rssi} dBm` : '';
      espWifiNetworkSelect.append(new Option(`${ssid}${signal}`, ssid));
    });
  }
  if (espWifiNetworks.some(({ ssid }) => ssid === previousValue)) {
    espWifiNetworkSelect.value = previousValue;
  }
  updateEspWifiUi();
}

function handleEspWifiStatus(bytes) {
  if (bytes.length < 4) return;
  const flags = bytes[1];
  const ssidLength = bytes[2];
  const ipLength = bytes[3];
  const end = 4 + ssidLength + ipLength;
  if (end > bytes.length) return;
  const decoder = new TextDecoder();
  espWifiState = {
    configured: Boolean(flags & 0x01),
    started: Boolean(flags & 0x02),
    connected: Boolean(flags & 0x04),
    ssid: decoder.decode(bytes.slice(4, 4 + ssidLength)),
    ip: decoder.decode(bytes.slice(4 + ssidLength, end)),
  };
  updateEspWifiUi();
}

function handleEspWifiScan(bytes) {
  if (bytes.length < 5) return;
  const index = bytes[1];
  const total = bytes[2];
  const rssi = bytes[3] > 127 ? bytes[3] - 256 : bytes[3];
  const ssidLength = bytes[4];
  if (5 + ssidLength > bytes.length) return;
  if (index === 0 || total !== espWifiScanExpected) espWifiNetworks = [];
  espWifiScanExpected = total;
  const ssid = new TextDecoder().decode(bytes.slice(5, 5 + ssidLength));
  if (ssid) espWifiNetworks[index] = { ssid, rssi };
  espWifiNetworks = espWifiNetworks.filter(Boolean);
  renderEspWifiNetworks();
  if (total === 0) setEspWifiStatus('没有发现 WiFi 网络');
  else if (espWifiNetworks.length >= total) setEspWifiStatus(`发现 ${total} 个 WiFi 网络`);
}

function handleEspWifiResult(bytes) {
  if (bytes.length < 2) return;
  const messages = {
    0: 'WiFi 操作已完成',
    1: 'WiFi 扫描启动失败',
    2: 'WiFi 扫描失败',
    3: 'WiFi 名称或密码格式不正确',
    4: 'WiFi 配置保存失败',
    5: 'WiFi 连接启动失败',
  };
  const message = messages[bytes[1]] || `WiFi 操作失败 (${bytes[1]})`;
  setEspWifiStatus(message);
}

function handleLinkBridgeStatus(value) {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (!bytes.length) return;
  if (bytes[0] === 0xa2) {
    handleEspWifiStatus(bytes);
    return;
  }
  if (bytes[0] === 0xa3) {
    handleEspWifiScan(bytes);
    return;
  }
  if (bytes[0] === 0xa4) {
    handleEspWifiResult(bytes);
    return;
  }
  if (bytes.length < 7 || bytes[0] !== LINK_BRIDGE_STATUS_MAGIC) return;
  const flags = bytes[1];
  const phase = parseUint16LE(bytes, 5) / 1000;
  linkDeviceState = {
    enabled: Boolean(flags & 0x01),
    wifi: Boolean(flags & 0x02),
    playing: Boolean(flags & 0x04),
    peers: bytes[2],
    tempo: parseUint16LE(bytes, 3) / 10,
    phase,
  };
  linkTempo = Math.max(LINK_TEMPO_MIN, Math.min(LINK_TEMPO_MAX, linkDeviceState.tempo || linkTempo));
  linkPlaying = linkDeviceState.playing;
  const beatIndex = Math.floor(phase) % 4;
  if (linkPlaying && beatIndex !== linkLastDeviceBeat) {
    linkLastDeviceBeat = beatIndex;
    updateLinkBeat(beatIndex);
    if (linkMetronomeEnabled) playMetronomeClick(beatIndex === 0);
  } else if (!linkPlaying) {
    linkLastDeviceBeat = -1;
    updateLinkBeat(0);
  }
  const state = linkDeviceState.enabled
    ? (linkDeviceState.wifi ? `LINK 已连接 · ${linkDeviceState.peers} 个设备` : 'LINK 已开启 · 等待 WiFi')
    : 'BLE MIDI 已连接 · LINK 未开启';
  setBleLinkStatus(state);
  updateLinkUi();
}

function playMetronomeClick(accent) {
  if (!linkMetronomeEnabled) return;
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) return;
  if (!linkAudioContext) linkAudioContext = new AudioContextConstructor();
  void linkAudioContext.resume();
  const oscillator = linkAudioContext.createOscillator();
  const gain = linkAudioContext.createGain();
  oscillator.frequency.value = accent ? 1320 : 880;
  gain.gain.setValueAtTime(accent ? 0.12 : 0.07, linkAudioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, linkAudioContext.currentTime + 0.045);
  oscillator.connect(gain).connect(linkAudioContext.destination);
  oscillator.start();
  oscillator.stop(linkAudioContext.currentTime + 0.05);
}

function updateLinkBeat(index) {
  linkBeatIndex = ((index % 4) + 4) % 4;
  Array.from(linkBeatGrid.children).forEach((dot, dotIndex) => {
    dot.classList.toggle('is-active', dotIndex === linkBeatIndex);
  });
}

function stopLocalLinkBeat() {
  if (linkBeatTimer) clearTimeout(linkBeatTimer);
  linkBeatTimer = undefined;
}

function scheduleLocalLinkBeat() {
  stopLocalLinkBeat();
  if (!linkPlaying || linkBridgeCharacteristic) return;
  const interval = 60000 / Math.max(LINK_TEMPO_MIN, Math.min(LINK_TEMPO_MAX, linkTempo));
  updateLinkBeat(linkBeatIndex);
  playMetronomeClick(linkBeatIndex === 0);
  linkBeatTimer = setTimeout(() => {
    linkBeatIndex = (linkBeatIndex + 1) % 4;
    scheduleLocalLinkBeat();
  }, interval);
}

function setLinkPlaying(playing, resetBeat = false) {
  linkPlaying = playing;
  if (resetBeat) updateLinkBeat(0);
  if (linkPlaying && !linkBridgeCharacteristic) scheduleLocalLinkBeat();
  else stopLocalLinkBeat();
  updateLinkUi();
}

function updateTempoFromMidiClock() {
  if (linkClockIntervals.length < 4) return;
  const average = linkClockIntervals.reduce((sum, value) => sum + value, 0) / linkClockIntervals.length;
  const bpm = 60000 / (average * 24);
  if (Number.isFinite(bpm) && bpm >= LINK_TEMPO_MIN && bpm <= LINK_TEMPO_MAX) {
    linkTempo = bpm;
    updateLinkUi();
  }
}

function handleBleMidiMessage(message) {
  const bytes = message.bytes;
  if (!bytes.length) return;
  const status = bytes[0];
  if (status === 0xF8) {
    const now = performance.now();
    if (linkLastClockTime > 0) {
      const interval = now - linkLastClockTime;
      if (interval > 5 && interval < 2000) {
        linkClockIntervals.push(interval);
        if (linkClockIntervals.length > 24) linkClockIntervals.shift();
        updateTempoFromMidiClock();
      }
    }
    linkLastClockTime = now;
    linkClockPulses++;
    updateLinkBeat(Math.floor(linkClockPulses / 24) % 4);
    return;
  }
  if (status === 0xFA || status === 0xFB) {
    linkClockPulses = status === 0xFA ? 0 : linkClockPulses;
    linkLastClockTime = 0;
    setLinkPlaying(true, status === 0xFA);
    return;
  }
  if (status === 0xFC) {
    setLinkPlaying(false);
    return;
  }
  if ((status & 0xF0) === 0xB0 && bytes[1] === 1 && bytes.length >= 3) {
    const deviceTempo = 20 + bytes[2];
    linkTempo = Math.max(LINK_TEMPO_MIN, Math.min(LINK_TEMPO_MAX, deviceTempo));
    updateLinkUi();
  }
}

function handleBleMidiNotification(event) {
  decodeBleMidiPacket(event.target.value).forEach(handleBleMidiMessage);
}

function handleLinkBridgeNotification(event) {
  handleLinkBridgeStatus(event.target.value);
}

function handleBleMidiDisconnect() {
  bleMidiCharacteristic = undefined;
  linkBridgeCharacteristic = undefined;
  bleMidiServer = undefined;
  bleMidiDevice = undefined;
  linkDeviceState = { enabled: false, wifi: false, playing: false, peers: 0, tempo: 120, phase: 0 };
  espWifiState = { configured: false, started: false, connected: false, ssid: '', ip: '' };
  espWifiNetworks = [];
  espWifiScanExpected = 0;
  renderEspWifiNetworks();
  linkLastDeviceBeat = -1;
  setLinkPlaying(false);
  linkPeerCount.textContent = '—';
  bleMidiDeviceName.textContent = '未连接';
  setBleLinkStatus('BLE MIDI 已断开');
  updateLinkUi();
}

async function connectBleMidi() {
  if (!navigator.bluetooth) {
    setBleLinkStatus(browserMessage('Web Bluetooth'));
    return;
  }
  bleMidiConnectButton.disabled = true;
  setBleLinkStatus('请在浏览器设备窗口中选择 HOHO 蓝牙设备…');
  try {
    bleMidiDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_MIDI_SERVICE_UUID] }],
      optionalServices: [BLE_MIDI_SERVICE_UUID],
    });
    bleMidiDevice.addEventListener('gattserverdisconnected', handleBleMidiDisconnect);
    bleMidiServer = await bleMidiDevice.gatt.connect();
    const service = await bleMidiServer.getPrimaryService(BLE_MIDI_SERVICE_UUID);
    bleMidiCharacteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC_UUID);
    if (bleMidiCharacteristic.properties.notify) {
      await bleMidiCharacteristic.startNotifications();
      bleMidiCharacteristic.addEventListener('characteristicvaluechanged', handleBleMidiNotification);
    }
    try {
      linkBridgeCharacteristic = await service.getCharacteristic(LINK_BRIDGE_CHARACTERISTIC_UUID);
      if (linkBridgeCharacteristic.properties.notify) {
        await linkBridgeCharacteristic.startNotifications();
        linkBridgeCharacteristic.addEventListener('characteristicvaluechanged', handleLinkBridgeNotification);
      }
      if (linkBridgeCharacteristic.properties.read) {
        handleLinkBridgeStatus(await linkBridgeCharacteristic.readValue());
      }
    } catch {
      linkBridgeCharacteristic = undefined;
    }
    bleMidiDeviceName.textContent = bleMidiDevice.name || 'BLE MIDI';
    setBleLinkStatus(linkBridgeCharacteristic ? 'BLE MIDI 已连接 · 等待 Link 状态' : 'BLE MIDI 已连接 · 需要新版 ESP32 固件读取 Link 状态');
    updateLinkUi();
  } catch (error) {
    bleMidiCharacteristic = undefined;
    linkBridgeCharacteristic = undefined;
    bleMidiServer = undefined;
    bleMidiDevice = undefined;
    if (error.name === 'NotFoundError') setBleLinkStatus('未选择 BLE MIDI 设备');
    else setBleLinkStatus(`BLE MIDI 连接失败：${error.message || error}`);
    updateLinkUi();
  }
}

async function disconnectBleMidi() {
  await stopBleMidiClock(false);
  if (bleMidiCharacteristic?.properties.notify) {
    try { await bleMidiCharacteristic.stopNotifications(); } catch { /* already disconnected */ }
    bleMidiCharacteristic.removeEventListener('characteristicvaluechanged', handleBleMidiNotification);
  }
  if (linkBridgeCharacteristic?.properties.notify) {
    try { await linkBridgeCharacteristic.stopNotifications(); } catch { /* already disconnected */ }
    linkBridgeCharacteristic.removeEventListener('characteristicvaluechanged', handleLinkBridgeNotification);
  }
  if (bleMidiDevice?.gatt?.connected) bleMidiDevice.gatt.disconnect();
  handleBleMidiDisconnect();
}

bleMidiConnectButton.addEventListener('click', () => void connectBleMidi());
bleMidiDisconnectButton.addEventListener('click', () => void disconnectBleMidi());
espWifiScanButton.addEventListener('click', async () => {
  if (!linkBridgeCharacteristic) return;
  espWifiNetworks = [];
  espWifiScanExpected = 0;
  renderEspWifiNetworks();
  setEspWifiStatus('正在扫描 WiFi…');
  espWifiScanButton.disabled = true;
  try {
    await sendLinkBridgeCommand(0x10);
  } catch (error) {
    setEspWifiStatus(`WiFi 扫描失败：${error.message || error}`);
    updateEspWifiUi();
  }
});
espWifiNetworkSelect.addEventListener('change', () => updateEspWifiUi());
espWifiSaveButton.addEventListener('click', async () => {
  const ssid = espWifiNetworkSelect.value;
  const password = espWifiPassword.value;
  if (!ssid || !linkBridgeCharacteristic) return;
  if (password.length > 64) {
    setEspWifiStatus('密码不能超过 64 个字符');
    return;
  }
  const ssidBytes = new TextEncoder().encode(ssid);
  const passwordBytes = new TextEncoder().encode(password);
  if (ssidBytes.length > 32 || passwordBytes.length > 64) {
    setEspWifiStatus('WiFi 名称或密码过长');
    return;
  }
  espWifiSaveButton.disabled = true;
  setEspWifiStatus(`正在保存并连接 ${ssid}…`);
  try {
    await sendLinkBridgeCommand(0x11, [ssidBytes.length, ...ssidBytes, passwordBytes.length, ...passwordBytes]);
  } catch (error) {
    setEspWifiStatus(`WiFi 配置失败：${error.message || error}`);
    updateEspWifiUi();
  }
});
linkEnableButton.addEventListener('click', async () => {
  const enabled = !(linkBridgeCharacteristic && linkDeviceState.enabled);
  try {
    if (linkBridgeCharacteristic) {
      if (enabled) {
        await stopBleMidiClock(true);
      }
      await sendLinkBridgeCommand(0x01, [enabled ? 1 : 0]);
      linkDeviceState.enabled = enabled;
      if (enabled) {
        setLinkPlaying(false);
      }
      updateLinkUi();
    } else if (await sendBleMidiMessage(Uint8Array.of(0x9F, 0x02, 0x7F))) {
      setBleLinkStatus('已发送 LINK 切换；旧固件无法回读状态');
    }
  } catch (error) {
    setBleLinkStatus(`LINK 切换失败：${error.message || error}`);
  }
});
linkPlayButton.addEventListener('click', async () => {
  try {
    if (isEsp32LinkMode()) {
      await sendLinkBridgeCommand(0x03);
      return;
    }
    if (linkBridgeCharacteristic) {
      if (await startBleMidiClock()) setLinkPlaying(true, true);
    } else if (await sendBleMidiMessage(Uint8Array.of(0xFA))) {
      setLinkPlaying(true, true);
    }
  } catch (error) {
    setBleLinkStatus(`发送 PLAY 失败：${error.message || error}`);
  }
});
linkStopButton.addEventListener('click', async () => {
  try {
    if (isEsp32LinkMode()) {
      await sendLinkBridgeCommand(0x04);
      return;
    }
    if (linkBridgeCharacteristic) {
      await stopBleMidiClock(true);
      setLinkPlaying(false);
    } else if (await sendBleMidiMessage(Uint8Array.of(0xFC))) {
      setLinkPlaying(false);
    }
  } catch (error) {
    setBleLinkStatus(`发送 STOP 失败：${error.message || error}`);
  }
});
linkMetronomeButton.addEventListener('click', () => {
  linkMetronomeEnabled = !linkMetronomeEnabled;
  updateLinkUi();
  if (linkMetronomeEnabled && linkPlaying && !linkBridgeCharacteristic) playMetronomeClick(linkBeatIndex === 0);
});
linkTempoSlider.addEventListener('input', async () => {
  linkTempo = Number(linkTempoSlider.value);
  if (bleMidiClockRunning) {
    bleMidiClockNextDue = Math.min(bleMidiClockNextDue, performance.now() + bleMidiClockIntervalMs());
  }
  updateLinkUi();
  if (!bleMidiCharacteristic) return;
  try {
    if (isEsp32LinkMode()) {
      const tenths = Math.round(linkTempo * 10);
      await sendLinkBridgeCommand(0x02, [tenths & 0xFF, (tenths >> 8) & 0xFF]);
    } else if (!linkBridgeCharacteristic) {
      const deviceValue = Math.max(0, Math.min(127, Math.round(linkTempo - 20)));
      await sendBleMidiMessage(Uint8Array.from([0xBF, 0x01, deviceValue]));
      if (linkTempo > 147) setBleLinkStatus('网页 Tempo 可到 300；旧 ESP32 MIDI 控制映射上限为 147 BPM');
    }
  } catch (error) {
    setBleLinkStatus(`发送 Tempo 失败：${error.message || error}`);
  }
});
renderEspWifiNetworks();
updateLinkUi();

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

async function handleSerialPortDisconnect(port) {
  if (serialPort !== port) return;
  try { await stopReading(); } catch { /* the device is already gone */ }
  if (serialWriter) {
    try { serialWriter.releaseLock(); } catch { /* already released */ }
    serialWriter = undefined;
  }
  serialPort = undefined;
  serialButton.textContent = '选择 CDC 设备';
  serialStatus.textContent = 'CDC 设备已断开';
  setAudioStatus('USB Audio / CDC 设备已断开，请检查固件或 USB 连接');
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
  navigator.serial.addEventListener('disconnect', (event) => {
    void handleSerialPortDisconnect(event.target);
    void refreshSerialDevices();
  });
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
    uniform float uSelected;
    uniform float uPulse;
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
      float pulse = uSelected * (0.42 + 0.16 * sin(uPulse * 0.004));
      color += mix(vec3(0.15, 0.32, 0.68), vec3(0.62, 0.84, 1.0), rim) * pulse;
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
    selected: gl.getUniformLocation(bodyProgram, 'uSelected'),
    pulse: gl.getUniformLocation(bodyProgram, 'uPulse'),
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
  const pitchLimit = Math.PI / 6;
  let yawVelocity = 0;
  let pitchVelocity = 0;
  let selectedBody = null;
  let focusTarget = null;
  let dragging = false;
  let moved = false;
  let suppressClick = false;
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
      label.setAttribute('aria-hidden', 'true');
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
      body.labelElement.classList.toggle('is-selected', body === selectedBody);
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

    const idleDriftX = Math.sin(time * 0.00008) * width * .012 + time * 0.00012;
    const idleDriftY = Math.cos(time * 0.00006) * height * .006;
    const driftX = yaw * width * .012 + idleDriftX;
    const driftY = pitch * height * .012 + idleDriftY;
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
  }

  function angleDelta(target, current) {
    return Math.atan2(Math.sin(target - current), Math.cos(target - current));
  }

  function updateFlightMotion(time) {
    if (focusTarget) {
      yaw += angleDelta(focusTarget.yaw, yaw) * .075;
      pitch += (focusTarget.pitch - pitch) * .075;
      yawVelocity *= .72;
      pitchVelocity *= .72;
      if (Math.abs(angleDelta(focusTarget.yaw, yaw)) < .001 && Math.abs(focusTarget.pitch - pitch) < .001) {
        yaw = focusTarget.yaw;
        pitch = focusTarget.pitch;
      }
      return;
    }

    if (dragging) return;
    yaw += yawVelocity;
    pitch = Math.max(-pitchLimit, Math.min(pitchLimit, pitch + pitchVelocity));
    yawVelocity *= .92;
    pitchVelocity *= .88;
    if (Math.abs(yawVelocity) < .00001) {
      yawVelocity = 0;
      yaw += .00012;
    }
    if (Math.abs(pitchVelocity) < .00001) pitchVelocity = 0;
    if (Math.abs(pitchVelocity) < .00001) {
      pitch += Math.sin(time * .00015) * .00003;
      pitch = Math.max(-pitchLimit, Math.min(pitchLimit, pitch));
    }
  }

  function render(time) {
    updateFlightMotion(time);
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
      gl.uniform1f(bodyUniforms.selected, body === selectedBody ? 1 : 0);
      gl.uniform1f(bodyUniforms.pulse, time);
      gl.drawElements(gl.TRIANGLES, sphere.count, gl.UNSIGNED_SHORT, 0);
    });
    updateLabels();
    requestAnimationFrame(render);
  }

  function focusWorld(key) {
    const body = bodies.find((item) => item.key === key);
    if (!body) return;
    selectedBody = body;
    focusTarget = {
      yaw: Math.atan2(-body.position[0], -body.position[2]),
      pitch: Math.max(-pitchLimit, Math.min(pitchLimit, -Math.atan2(body.position[1], Math.hypot(body.position[0], body.position[2])))),
    };
    yawVelocity = 0;
    pitchVelocity = 0;
    activateTab(worldTabs[body.key] || 'update');
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

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    moved = false;
    dragDistance = 0;
    yawVelocity = 0;
    pitchVelocity = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
    document.body.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    event.preventDefault();
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    dragDistance += Math.abs(dx) + Math.abs(dy);
    const sensitivity = .00235;
    const yawDelta = -dx * sensitivity;
    const pitchDelta = -dy * sensitivity;
    yaw += yawDelta;
    pitch = Math.max(-pitchLimit, Math.min(pitchLimit, pitch + pitchDelta));
    yawVelocity = yawDelta;
    pitchVelocity = pitchDelta;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 3) {
      focusTarget = null;
      selectedBody = null;
    }
    lastX = event.clientX;
    lastY = event.clientY;
  });
  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('is-dragging');
    if (dragDistance > 8) document.querySelector('.status-pill')?.replaceChildren(Object.assign(document.createElement('i'), { className: '' }), document.createTextNode(' 3D FLIGHT'));
    suppressClick = dragDistance > 8;
    window.setTimeout(() => { suppressClick = false; }, 120);
    dragDistance = 0;
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('click', (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    updateCamera();
    const hit = bodies.map((body) => ({ body, position: screenPosition(body) })).filter((item) => item.position).sort((a, b) => a.position.radius - b.position.radius).find(({ position }) => Math.hypot(event.clientX - position.x, event.clientY - position.y) < position.radius + 18);
    if (hit) focusWorld(hit.body.key);
  });
  document.querySelectorAll('[data-world]').forEach((tag) => {
    tag.addEventListener('click', () => focusWorld(tag.dataset.world));
  });
  window.addEventListener('resize', resize);
  resize();
  render(performance.now());
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
