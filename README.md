# GOHO University Web

GOHO University 产品与在线硬件工具的第一版静态网页原型。

## 当前内容

- 产品入口页：U Modules、VST Plugins、Small Software、Web Tools
- WebUSB 授权设备列表、固件文件选择、DFU 烧录流程入口
- Web Serial 授权 CDC/串口设备列表、Start/Stop、TXT/HEX 接收与发送、LF/CRLF 行尾

> 当前 DFU 页面已经完成“选择设备 + 选择固件”的交互。真正的固件传输需要根据 U 模块的 VID/PID、DFU 接口和固件协议接入，避免向未知 USB 设备发送错误数据。

## 本地预览

```bash
cd GOHO_Web
python3 -m http.server 4173
```

然后打开 <http://localhost:4173>。Web Serial/WebUSB 需要 HTTPS 或 localhost，并且主要支持 Chromium 系浏览器。
