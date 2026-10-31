const dfuButton = document.querySelector('#dfuButton');
const dfuStatus = document.querySelector('#dfuStatus');
const usbDeviceSelect = document.querySelector('#usbDeviceSelect');
const refreshUsb = document.querySelector('#refreshUsb');
const serialButton = document.querySelector('#serialButton');
const serialStatus = document.querySelector('#serialStatus');
const serialDeviceSelect = document.querySelector('#serialDeviceSelect');
const refreshSerial = document.querySelector('#refreshSerial');
const monitorPanel = document.querySelector('#monitorPanel');
const serialLog = document.querySelector('#serialLog');
const clearLog = document.querySelector('#clearLog');
const sendForm = document.querySelector('#sendForm');
const sendInput = document.querySelector('#sendInput');
const baudRate = document.querySelector('#baudRate');

let usbDevices = [];
let serialPorts = [];
let serialPort;
let writer;

function writeLog(message) {
  const time = new Date().toLocaleTimeString();
  serialLog.textContent += `\n[${time}] ${message}`;
  serialLog.scrollTop = serialLog.scrollHeight;
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
  return vendor && product ? `CDC ${vendor}:${product}` : '串口设备';
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
    return;
  }
  usbDevices.forEach((device, index) => {
    usbDeviceSelect.add(new Option(`${deviceName(device)} · ${device.serialNumber || '无序列号'}`, String(index)));
  });
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
    const info = port.getInfo();
    const suffix = info.usbProductId ? ` · ${portName(port)}` : ' · 系统串口';
    serialDeviceSelect.add(new Option(`${portName(port)}${suffix}`, String(index)));
  });
}

dfuButton.addEventListener('click', async () => {
  if (!('usb' in navigator)) {
    dfuStatus.textContent = browserMessage('WebUSB');
    return;
  }
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await refreshUsbDevices();
    const index = usbDevices.indexOf(device);
    if (index >= 0) usbDeviceSelect.value = String(index);
    dfuStatus.textContent = `已选择：${deviceName(device)}（DFU 协议待接入）`;
  } catch (error) {
    if (error.name !== 'NotFoundError') dfuStatus.textContent = `连接失败：${error.message}`;
  }
});

refreshUsb.addEventListener('click', () => refreshUsbDevices().catch((error) => {
  dfuStatus.textContent = `刷新失败：${error.message}`;
}));

async function readSerial() {
  const decoder = new TextDecoderStream();
  const readableStreamClosed = serialPort.readable.pipeTo(decoder.writable);
  const reader = decoder.readable.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      writeLog(value);
    }
  } catch (error) {
    writeLog(`读取结束：${error.message}`);
  } finally {
    reader.releaseLock();
    await readableStreamClosed.catch(() => {});
  }
}

serialButton.addEventListener('click', async () => {
  if (!('serial' in navigator)) {
    serialStatus.textContent = browserMessage('Web Serial');
    return;
  }
  try {
    if (serialPort) {
      await serialPort.close();
      serialPort = undefined;
      writer = undefined;
      serialButton.textContent = '选择串口';
      serialStatus.textContent = '已断开';
      await refreshSerialDevices();
      return;
    }
    const selectedIndex = serialDeviceSelect.value;
    serialPort = selectedIndex === '' ? await navigator.serial.requestPort() : serialPorts[Number(selectedIndex)];
    await serialPort.open({ baudRate: Number(baudRate.value) });
    writer = serialPort.writable.getWriter();
    monitorPanel.hidden = false;
    serialButton.textContent = '断开串口';
    serialStatus.textContent = `已连接：${portName(serialPort)}`;
    writeLog(`串口已连接，波特率 ${baudRate.value}`);
    readSerial();
  } catch (error) {
    serialStatus.textContent = error.name === 'NotFoundError' ? '未选择设备' : `连接失败：${error.message}`;
    serialPort = undefined;
    writer = undefined;
  }
});

refreshSerial.addEventListener('click', () => refreshSerialDevices().catch((error) => {
  serialStatus.textContent = `刷新失败：${error.message}`;
}));

sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!writer || !sendInput.value) return;
  await writer.write(new TextEncoder().encode(`${sendInput.value}\n`));
  writeLog(`> ${sendInput.value}`);
  sendInput.value = '';
});

clearLog.addEventListener('click', () => {
  serialLog.textContent = '日志已清空。';
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
